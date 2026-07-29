import type { DatabaseTransactionExecutor, TenantContext } from "../../../infrastructure/database";
import { withTransaction } from "../../../infrastructure/database";
import type { ManualWhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  ManualConnectionValidationError,
  manualMetaTransportIssueCode,
  WhatsAppConnectionCompletionConflictError,
  WhatsAppConnectionCredentialEncryptionError,
  type WhatsAppConnectionMetaOperation,
  WhatsAppConnectionMetaTransportError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionPhoneNumberAlreadyAssignedError,
  WhatsAppConnectionValidationError,
} from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import { normalizeConnectionId } from "../domain/whatsapp-connection.validation";
import type { ManualMetaAppTransport, ManualMetaPhoneNumber, ManualMetaWaba } from "../infrastructure/meta/manual-meta-app.transport";
import { missingManualSystemUserRequiredScope } from "./manual-system-user-token-validation";
import { recordWhatsAppConnectionAudit } from "./whatsapp-connection-operational-events";
import type { WhatsAppConnectionCredentialEncryptionService } from "./whatsapp-connection-credential-encryption.service";

export type ManualConnectionDiscoveryResult = Readonly<{
  connectionId: string;
  validation: Readonly<{
    valid: true;
    tokenType: "SYSTEM_USER";
    expiresAt: string | null;
  }>;
  wabas: readonly ManualConnectionDiscoveredWaba[];
}>;

export type ManualConnectionDiscoveredWaba = Readonly<{
  wabaId: string;
  name: string | null;
  accountStatus: string | null;
  phoneNumbers: readonly Readonly<{
    phoneNumberId: string;
    maskedDisplayPhoneNumber: string | null;
    verifiedName: string | null;
    status: string | null;
    codeVerificationStatus: string | null;
  }>[];
}>;

export type ManualConnectionSelectAssetsInput = Readonly<{
  wabaId: string;
  phoneNumberId: string;
}>;

export type ManualConnectionSelectAssetsResult = Readonly<{
  connection: Readonly<{
    connectionId: string;
    status: "VERIFYING";
    connectionMethod: "CUSTOMER_OWNED_META_APP";
    appId: string;
    maskedPhoneNumber: string | null;
    verifiedName: string | null;
  }>;
  nextStep: "CONFIGURE_WEBHOOK";
}>;

type TransactionRunner = <Result>(callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>) => Promise<Result>;
const META_ASSET_ID_MAX_LENGTH = 32;

function normalizeManualAssetId(value: unknown): string {
  if (typeof value !== "string") throw new WhatsAppConnectionValidationError();
  const normalized = value.trim();
  if (!normalized || normalized.length > META_ASSET_ID_MAX_LENGTH || !/^[0-9]+$/u.test(normalized)) {
    throw new WhatsAppConnectionValidationError();
  }
  return normalized;
}

function maskPhoneNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 4) return "••••";
  return `${"•".repeat(Math.min(8, Math.max(4, digits.length - 4)))}${digits.slice(-4)}`;
}

function assertManualDraft(connection: WhatsAppConnection | null): WhatsAppConnection {
  if (!connection || connection.connectionMethod !== "CUSTOMER_OWNED_META_APP") throw new ManualConnectionValidationError("META_APP_CREDENTIALS_INVALID");
  if (!connection.metaAppId || (connection.status !== "PENDING" && connection.status !== "VERIFYING")) throw new WhatsAppConnectionCompletionConflictError();
  return connection;
}

async function withMetaOperation<Result>(
  operation: WhatsAppConnectionMetaOperation,
  callback: () => Promise<Result>,
): Promise<Result> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof WhatsAppConnectionMetaTransportError && !error.operation) {
      throw new WhatsAppConnectionMetaTransportError(error.code, {
        operation,
        httpStatus: error.httpStatus,
        metaErrorCode: error.metaErrorCode,
      });
    }
    throw error;
  }
}

function classifyTransport(error: unknown): never {
  if (error instanceof ManualConnectionValidationError) throw error;
  if (error instanceof WhatsAppConnectionCredentialEncryptionError) throw new ManualConnectionValidationError("META_APP_CREDENTIALS_INVALID");
  if (error instanceof WhatsAppConnectionPhoneNumberAlreadyAssignedError) throw new WhatsAppConnectionCompletionConflictError();
  if (error instanceof WhatsAppConnectionMetaTransportError) {
    const issueCode = manualMetaTransportIssueCode(error);
    if (error.operation) {
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_meta_graph_failed", {
        metaOperation: error.operation,
        httpStatus: error.httpStatus,
        metaErrorCode: error.metaErrorCode,
        metaErrorSubcode: error.metaErrorSubcode,
        issueCode,
      });
    }
    throw new ManualConnectionValidationError(issueCode);
  }
  if (error instanceof WhatsAppConnectionCompletionConflictError || error instanceof WhatsAppConnectionValidationError) throw error;
  throw new WhatsAppConnectionPersistenceError(error);
}

function safeWabas(wabas: readonly ManualMetaWaba[], phonesByWaba: ReadonlyMap<string, readonly ManualMetaPhoneNumber[]>): readonly ManualConnectionDiscoveredWaba[] {
  return wabas.map((waba) => ({
    wabaId: waba.id,
    name: waba.name ?? null,
    accountStatus: waba.accountStatus ?? null,
    phoneNumbers: (phonesByWaba.get(waba.id) ?? []).map((phone) => ({
      phoneNumberId: phone.id,
      maskedDisplayPhoneNumber: maskPhoneNumber(phone.displayPhoneNumber),
      verifiedName: phone.verifiedName ?? null,
      status: phone.status ?? null,
      codeVerificationStatus: phone.codeVerificationStatus ?? null,
    })),
  }));
}

export class ManualConnectionAssetsService {
  constructor(
    private readonly repository: ManualWhatsAppConnectionRepository,
    private readonly encryptionService: WhatsAppConnectionCredentialEncryptionService | null,
    private readonly metaTransport: ManualMetaAppTransport,
    private readonly transactionRunner: TransactionRunner = withTransaction,
  ) {}

  async discover(tenant: TenantContext, connectionId: string): Promise<ManualConnectionDiscoveryResult> {
    const connection = assertManualDraft(await this.repository.findByConnectionId(tenant, normalizeConnectionId(connectionId)));
    try {
      const context = await this.validateStoredCredentials(tenant, connection);
      const { wabas, phonesByWaba } = await this.discoverAssets(
        context.systemUserId,
        context.systemUserAccessToken,
        context.assignedWabaIds,
      );
      const current = assertManualDraft(await this.repository.findByConnectionId(tenant, connection.connectionId));
      if (current.updatedAt.getTime() !== connection.updatedAt.getTime()) {
        throw new WhatsAppConnectionCompletionConflictError();
      }
      return {
        connectionId: connection.connectionId,
        validation: { valid: true, tokenType: "SYSTEM_USER", expiresAt: context.expiresAt ? context.expiresAt.toISOString() : null },
        wabas: safeWabas(wabas, phonesByWaba),
      };
    } catch (error) {
      classifyTransport(error);
    }
  }

  async selectAssets(tenant: TenantContext, connectionId: string, rawInput: ManualConnectionSelectAssetsInput): Promise<ManualConnectionSelectAssetsResult> {
    const wabaId = normalizeManualAssetId(rawInput.wabaId);
    const phoneNumberId = normalizeManualAssetId(rawInput.phoneNumberId);
    const connection = assertManualDraft(await this.repository.findByConnectionId(tenant, normalizeConnectionId(connectionId)));
    try {
      const selected = await this.validateSelection(tenant, connection, wabaId, phoneNumberId);
      const updated = await this.transactionRunner(async (executor) => {
        const current = assertManualDraft(await this.repository.findByConnectionId(tenant, connection.connectionId, { executor }));
        if (current.updatedAt.getTime() !== connection.updatedAt.getTime()) {
          throw new WhatsAppConnectionCompletionConflictError();
        }
        const withMetadata = await this.repository.persistVerifiedMetadata(tenant, current.connectionId, {
          wabaId,
          phoneNumberId,
          displayPhoneNumber: selected.displayPhoneNumber ?? null,
          verifiedName: selected.verifiedName ?? null,
        }, { executor });
        if (!withMetadata) throw new WhatsAppConnectionPersistenceError();
        const verifying = await this.repository.updateLifecycleStatus(tenant, current.connectionId, "VERIFYING", { executor });
        if (!verifying) throw new WhatsAppConnectionPersistenceError();
        return verifying;
      });
      if (!updated.metaAppId) throw new WhatsAppConnectionPersistenceError();
      return {
        connection: {
          connectionId: updated.connectionId,
          status: "VERIFYING",
          connectionMethod: "CUSTOMER_OWNED_META_APP",
          appId: updated.metaAppId,
          maskedPhoneNumber: maskPhoneNumber(updated.displayPhoneNumber),
          verifiedName: updated.verifiedName ?? null,
        },
        nextStep: "CONFIGURE_WEBHOOK",
      };
    } catch (error) {
      classifyTransport(error);
    }
  }

  private async validateSelection(tenant: TenantContext, connection: WhatsAppConnection, wabaId: string, phoneNumberId: string): Promise<ManualMetaPhoneNumber> {
    const assigned = await this.repository.resolveByPhoneNumberId(phoneNumberId);
    if (assigned && assigned.sellerId !== tenant.sellerId) throw new WhatsAppConnectionPhoneNumberAlreadyAssignedError();
    const context = await this.validateStoredCredentials(tenant, connection);
    if (!this.metaTransport.readWaba) throw new ManualConnectionValidationError("META_GRAPH_REQUEST_REJECTED");
    const waba = await withMetaOperation(
      "read_waba",
      () => this.metaTransport.readWaba!(wabaId, context.systemUserAccessToken),
    );
    if (waba.id !== wabaId) throw new ManualConnectionValidationError("META_WABA_NOT_FOUND");
    if (!this.metaTransport.readPhoneNumber) throw new ManualConnectionValidationError("META_GRAPH_REQUEST_REJECTED");
    const selected = await withMetaOperation(
      "read_phone_number",
      () => this.metaTransport.readPhoneNumber!(phoneNumberId, context.systemUserAccessToken),
    );
    if (selected.id !== phoneNumberId) throw new ManualConnectionValidationError("META_PHONE_NOT_FOUND");
    const wabaPhones = await withMetaOperation(
      "list_waba_phone_numbers",
      () => this.metaTransport.listPhoneNumbers(wabaId, context.systemUserAccessToken),
    );
    const member = wabaPhones.find((phone) => phone.id === phoneNumberId && phone.wabaId === wabaId);
    if (!member) throw new ManualConnectionValidationError("META_PHONE_WABA_MISMATCH");
    if (
      selected.displayPhoneNumber
      && member.displayPhoneNumber
      && selected.displayPhoneNumber !== member.displayPhoneNumber
    ) {
      throw new ManualConnectionValidationError("META_GRAPH_REQUEST_REJECTED");
    }
    if (
      selected.verifiedName
      && member.verifiedName
      && selected.verifiedName !== member.verifiedName
    ) {
      throw new ManualConnectionValidationError("META_GRAPH_REQUEST_REJECTED");
    }
    return {
      ...selected,
      wabaId,
      displayPhoneNumber: selected.displayPhoneNumber ?? member.displayPhoneNumber,
      verifiedName: selected.verifiedName ?? member.verifiedName,
      qualityRating: selected.qualityRating ?? member.qualityRating,
      status: selected.status ?? member.status,
    };
  }

  private async validateStoredCredentials(tenant: TenantContext, connection: WhatsAppConnection): Promise<{ systemUserId: string; systemUserAccessToken: string; expiresAt: Date | null; assignedWabaIds: readonly string[] }> {
    if (!this.encryptionService || !connection.metaAppId) throw new ManualConnectionValidationError("META_APP_CREDENTIALS_INVALID");
    const storage = await this.repository.findManualCredentialStorage(tenant, connection.connectionId);
    if (!storage) throw new ManualConnectionValidationError("META_APP_CREDENTIALS_INVALID");
    let appSecret: string;
    let systemUserAccessToken: string;
    try {
      appSecret = this.encryptionService.decryptManualMetaAppSecret(storage.encryptedMetaAppSecret);
      systemUserAccessToken = this.encryptionService.decryptManualSystemUserAccessToken(storage.encryptedSystemUserAccessToken);
    } catch {
      throw new ManualConnectionValidationError("META_APP_CREDENTIALS_INVALID");
    }
    recordWhatsAppConnectionAudit("whatsapp_connection.manual_token_source_resolved", {
      tokenSource: "encrypted_connection_token",
    });
    const inspection = await withMetaOperation(
      "inspect_system_user_token",
      () => this.metaTransport.inspectSystemUserToken(connection.metaAppId!, appSecret, systemUserAccessToken),
    );
    if (!inspection.valid) throw new ManualConnectionValidationError("META_TOKEN_INVALID");
    if (inspection.appId !== connection.metaAppId) throw new ManualConnectionValidationError("META_TOKEN_APP_MISMATCH");
    if (inspection.expiresAt && inspection.expiresAt.getTime() <= Date.now()) throw new ManualConnectionValidationError("META_TOKEN_EXPIRED");
    const type = (inspection.type ?? "").toUpperCase();
    if (type !== "SYSTEM_USER") throw new ManualConnectionValidationError("META_TOKEN_TYPE_UNSUPPORTED");
    if (missingManualSystemUserRequiredScope(inspection.scopes)) {
      throw new ManualConnectionValidationError("META_REQUIRED_PERMISSION_MISSING");
    }
    if (!inspection.systemUserId) throw new ManualConnectionValidationError("META_TOKEN_TYPE_UNSUPPORTED");
    return {
      systemUserId: inspection.systemUserId,
      systemUserAccessToken,
      expiresAt: inspection.expiresAt ?? null,
      assignedWabaIds: inspection.assignedWabaIds ?? [],
    };
  }

  private async discoverAssets(systemUserId: string, systemUserAccessToken: string, assignedWabaIds: readonly string[]): Promise<{ wabas: readonly ManualMetaWaba[]; phonesByWaba: ReadonlyMap<string, readonly ManualMetaPhoneNumber[]> }> {
    let wabas: readonly ManualMetaWaba[];
    let directlyVerified = false;
    if (assignedWabaIds.length > 0 && this.metaTransport.readWaba) {
      wabas = await Promise.all(assignedWabaIds.map((wabaId) => withMetaOperation(
        "read_waba",
        () => this.metaTransport.readWaba!(wabaId, systemUserAccessToken),
      )));
      directlyVerified = true;
    } else {
      wabas = await withMetaOperation(
        "list_assigned_wabas",
        () => this.metaTransport.listAssignedWabas(systemUserId, systemUserAccessToken),
      );
    }
    if (!wabas.length) {
      throw new ManualConnectionValidationError(
        directlyVerified ? "META_WABA_ACCESS_MISSING" : "META_ASSET_DISCOVERY_FAILED",
      );
    }
    if (!this.metaTransport.readWaba) throw new ManualConnectionValidationError("META_GRAPH_REQUEST_REJECTED");
    const phonesByWaba = new Map<string, readonly ManualMetaPhoneNumber[]>();
    for (const waba of wabas) {
      const verifiedWaba = directlyVerified
        ? waba
        : await withMetaOperation(
          "read_waba",
          () => this.metaTransport.readWaba!(waba.id, systemUserAccessToken),
        );
      if (verifiedWaba.id !== waba.id) throw new ManualConnectionValidationError("META_WABA_NOT_FOUND");
      const phones = await withMetaOperation(
        "list_waba_phone_numbers",
        () => this.metaTransport.listPhoneNumbers(verifiedWaba.id, systemUserAccessToken),
      );
      if (phones.some((phone) => !phone.id || phone.wabaId !== verifiedWaba.id)) {
        throw new ManualConnectionValidationError("META_GRAPH_REQUEST_REJECTED");
      }
      phonesByWaba.set(verifiedWaba.id, phones);
    }
    if (![...phonesByWaba.values()].some((phones) => phones.length > 0)) {
      throw new ManualConnectionValidationError("META_PHONE_NOT_FOUND");
    }
    return { wabas, phonesByWaba };
  }
}

export const __phase11kM2ManualAssetsTesting = {
  maskPhoneNumber,
};
