import type { DatabaseTransactionExecutor, TenantContext } from "../../../infrastructure/database";
import { withTransaction } from "../../../infrastructure/database";
import type { ManualWhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  ManualConnectionValidationError,
  WhatsAppConnectionCompletionConflictError,
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionMetaTransportError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionPhoneNumberAlreadyAssignedError,
  WhatsAppConnectionValidationError,
} from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import { normalizeConnectionId, normalizeMetaId } from "../domain/whatsapp-connection.validation";
import type { ManualMetaAppTransport, ManualMetaPhoneNumber, ManualMetaWaba } from "../infrastructure/meta/manual-meta-app.transport";
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

const REQUIRED_SCOPES = ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"] as const;

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

function classifyTransport(error: unknown): never {
  if (error instanceof ManualConnectionValidationError) throw error;
  if (error instanceof WhatsAppConnectionCredentialEncryptionError) throw new ManualConnectionValidationError("META_APP_CREDENTIALS_INVALID");
  if (error instanceof WhatsAppConnectionPhoneNumberAlreadyAssignedError) throw new WhatsAppConnectionCompletionConflictError();
  if (error instanceof WhatsAppConnectionMetaTransportError) {
    if (error.code === "auth") throw new ManualConnectionValidationError("META_TOKEN_INVALID");
    if (error.code === "validation") throw new ManualConnectionValidationError("META_ASSET_DISCOVERY_FAILED");
    throw new ManualConnectionValidationError("META_ASSET_DISCOVERY_FAILED");
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
      const { wabas, phonesByWaba } = await this.discoverAssets(context.systemUserId, context.systemUserAccessToken);
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
    const wabaId = normalizeMetaId(rawInput.wabaId);
    const phoneNumberId = normalizeMetaId(rawInput.phoneNumberId);
    if (!wabaId || !phoneNumberId) throw new WhatsAppConnectionValidationError();
    const connection = assertManualDraft(await this.repository.findByConnectionId(tenant, normalizeConnectionId(connectionId)));
    try {
      const selected = await this.validateSelection(tenant, connection, wabaId, phoneNumberId);
      const updated = await this.transactionRunner(async (executor) => {
        const current = assertManualDraft(await this.repository.findByConnectionId(tenant, connection.connectionId, { executor }));
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
    const { wabas, phonesByWaba } = await this.discoverAssets(context.systemUserId, context.systemUserAccessToken);
    if (!wabas.some((waba) => waba.id === wabaId)) throw new ManualConnectionValidationError("META_WABA_ACCESS_MISSING");
    const selected = (phonesByWaba.get(wabaId) ?? []).find((phone) => phone.id === phoneNumberId);
    if (!selected) throw new ManualConnectionValidationError("META_ASSET_DISCOVERY_FAILED");
    return selected;
  }

  private async validateStoredCredentials(tenant: TenantContext, connection: WhatsAppConnection): Promise<{ systemUserId: string; systemUserAccessToken: string; expiresAt: Date | null }> {
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
    const inspection = await this.metaTransport.inspectSystemUserToken(connection.metaAppId, appSecret, systemUserAccessToken);
    if (!inspection.valid) throw new ManualConnectionValidationError("META_TOKEN_INVALID");
    if (inspection.appId !== connection.metaAppId) throw new ManualConnectionValidationError("META_TOKEN_APP_MISMATCH");
    if (inspection.expiresAt && inspection.expiresAt.getTime() <= Date.now()) throw new ManualConnectionValidationError("META_TOKEN_EXPIRED");
    const type = (inspection.type ?? "").toUpperCase();
    if (type !== "SYSTEM_USER") throw new ManualConnectionValidationError("META_TOKEN_TYPE_UNSUPPORTED");
    for (const scope of REQUIRED_SCOPES) {
      if (!inspection.scopes.includes(scope)) throw new ManualConnectionValidationError("META_PERMISSION_MISSING");
    }
    if (!inspection.systemUserId) throw new ManualConnectionValidationError("META_TOKEN_TYPE_UNSUPPORTED");
    return { systemUserId: inspection.systemUserId, systemUserAccessToken, expiresAt: inspection.expiresAt ?? null };
  }

  private async discoverAssets(systemUserId: string, systemUserAccessToken: string): Promise<{ wabas: readonly ManualMetaWaba[]; phonesByWaba: ReadonlyMap<string, readonly ManualMetaPhoneNumber[]> }> {
    const wabas = await this.metaTransport.listAssignedWabas(systemUserId, systemUserAccessToken);
    if (!wabas.length) throw new ManualConnectionValidationError("META_WABA_ACCESS_MISSING");
    const phonesByWaba = new Map<string, readonly ManualMetaPhoneNumber[]>();
    for (const waba of wabas) {
      const phones = await this.metaTransport.listPhoneNumbers(waba.id, systemUserAccessToken);
      phonesByWaba.set(waba.id, phones);
    }
    if (![...phonesByWaba.values()].some((phones) => phones.length > 0)) throw new ManualConnectionValidationError("META_ASSET_DISCOVERY_FAILED");
    return { wabas, phonesByWaba };
  }
}

export const __phase11kM2ManualAssetsTesting = {
  maskPhoneNumber,
};
