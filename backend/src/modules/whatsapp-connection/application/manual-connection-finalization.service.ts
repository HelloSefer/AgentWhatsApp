import { randomInt } from "node:crypto";
import type { DatabaseTransactionExecutor, TenantContext } from "../../../infrastructure/database";
import { withTransaction } from "../../../infrastructure/database";
import type { ManualWhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  ManualFinalizationError,
  ManualWebhookConfigurationError,
  WhatsAppConnectionActiveAlreadyExistsError,
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionMetaTransportError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionPhoneNumberAlreadyAssignedError,
} from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import { normalizeConnectionId } from "../domain/whatsapp-connection.validation";
import type { ManualMetaWebhookTransport } from "../infrastructure/meta/manual-meta-app.transport";
import type { WhatsAppConnectionCredentialEncryptionService } from "./whatsapp-connection-credential-encryption.service";
import { buildManualWebhookCallbackUrl } from "./manual-webhook-url.service";
import { incrementWhatsAppConnectionMetric, recordWhatsAppConnectionAudit } from "./whatsapp-connection-operational-events";

export type ManualConnectionFinalizeResult = Readonly<{
  connection: Readonly<{
    connectionId: string;
    status: "ACTIVE";
    connectionMethod: "CUSTOMER_OWNED_META_APP";
    maskedPhoneNumber: string | null;
    verifiedName: string | null;
    connectedAt: string;
  }>;
  health: Readonly<{ status: "HEALTHY" }>;
  replacedPreviousConnection?: true;
}>;

type TransactionRunner = <Result>(callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>) => Promise<Result>;

const REQUIRED_SCOPES = ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"] as const;

function maskPhoneNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 4) return "••••";
  return `${"•".repeat(Math.min(8, Math.max(4, digits.length - 4)))}${digits.slice(-4)}`;
}

function generateRegistrationPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function assertManualFinalizable(connection: WhatsAppConnection | null): WhatsAppConnection {
  if (!connection || connection.connectionMethod !== "CUSTOMER_OWNED_META_APP") throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
  if (connection.status === "ACTIVE") return connection;
  if (connection.status !== "VERIFYING") throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
  if (!connection.metaAppId || !connection.wabaId || !connection.phoneNumberId || !connection.publicWebhookId) {
    throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
  }
  return connection;
}

function classifyMeta(error: unknown): never {
  if (error instanceof ManualFinalizationError) throw error;
  if (error instanceof ManualWebhookConfigurationError && error.issueCode === "WEBHOOK_PUBLIC_URL_INVALID") throw new ManualFinalizationError("WEBHOOK_PUBLIC_URL_INVALID");
  if (error instanceof WhatsAppConnectionPhoneNumberAlreadyAssignedError || error instanceof WhatsAppConnectionActiveAlreadyExistsError) throw new ManualFinalizationError("CONNECTION_ACTIVATION_CONFLICT");
  if (error instanceof WhatsAppConnectionCredentialEncryptionError) throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
  if (error instanceof WhatsAppConnectionMetaTransportError) {
    if (error.code === "auth") throw new ManualFinalizationError("META_PERMISSION_MISSING");
    if (error.code === "unavailable") throw new ManualFinalizationError("META_TRANSIENT_FAILURE");
    throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
  }
  throw new WhatsAppConnectionPersistenceError(error);
}

export class ManualConnectionFinalizationService {
  constructor(
    private readonly repository: ManualWhatsAppConnectionRepository,
    private readonly encryptionService: WhatsAppConnectionCredentialEncryptionService | null,
    private readonly metaTransport: ManualMetaWebhookTransport,
    private readonly publicBaseUrl?: string,
    private readonly transactionRunner: TransactionRunner = withTransaction,
  ) {}

  async finalize(tenant: TenantContext, connectionId: string): Promise<ManualConnectionFinalizeResult> {
    const connection = assertManualFinalizable(await this.repository.findByConnectionId(tenant, normalizeConnectionId(connectionId)));
    if (connection.status === "ACTIVE") return responseFromConnection(connection, false);
    recordWhatsAppConnectionAudit("whatsapp_connection.manual_finalization_started", { sellerId: tenant.sellerId, connectionId: connection.connectionId });
    try {
      const readiness = await this.verifyReadiness(tenant, connection);
      const replacedPreviousConnection = await this.activateAtomically(tenant, connection.connectionId);
      const active = assertManualFinalizable(await this.repository.findByConnectionId(tenant, connection.connectionId));
      if (active.status !== "ACTIVE") throw new WhatsAppConnectionPersistenceError();
      recordWhatsAppConnectionAudit(replacedPreviousConnection ? "whatsapp_connection.manual_replacement_completed" : "whatsapp_connection.manual_connection_activated", { sellerId: tenant.sellerId, connectionId: active.connectionId, status: active.status });
      incrementWhatsAppConnectionMetric("whatsapp_connections_active_total", { sellerId: tenant.sellerId, connectionId: active.connectionId, status: active.status });
      return responseFromConnection(active, replacedPreviousConnection);
    } catch (error) {
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_readiness_failed", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "verification_failed" });
      classifyMeta(error);
    }
  }

  private async verifyReadiness(tenant: TenantContext, connection: WhatsAppConnection): Promise<void> {
    if (!this.encryptionService || !connection.metaAppId || !connection.wabaId || !connection.phoneNumberId || !connection.publicWebhookId) throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
    if (!connection.wabaSubscriptionCompletedAt) throw new ManualFinalizationError("WEBHOOK_NOT_CONFIGURED");
    let systemUserToken: string;
    let appSecret: string;
    let verifyToken: string;
    const storage = await this.repository.findManualCredentialStorage(tenant, connection.connectionId);
    if (!storage) throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
    try {
      appSecret = this.encryptionService.decryptManualMetaAppSecret(storage.encryptedMetaAppSecret);
      systemUserToken = this.encryptionService.decryptManualSystemUserAccessToken(storage.encryptedSystemUserAccessToken);
      verifyToken = this.encryptionService.decryptManualWebhookVerifyToken(storage.encryptedWebhookVerifyToken);
    } catch {
      throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
    }
    if (!verifyToken) throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
    const callbackUrl = buildManualWebhookCallbackUrl(connection.publicWebhookId, this.publicBaseUrl);
    const inspection = await this.metaTransport.inspectSystemUserToken(connection.metaAppId, appSecret, systemUserToken);
    if (!inspection.valid) throw new ManualFinalizationError("META_TOKEN_INVALID");
    if (inspection.expiresAt && inspection.expiresAt.getTime() <= Date.now()) throw new ManualFinalizationError("META_TOKEN_EXPIRED");
    if (inspection.appId !== connection.metaAppId) throw new ManualFinalizationError("META_TOKEN_APP_MISMATCH");
    if ((inspection.type ?? "").toUpperCase() !== "SYSTEM_USER" || !inspection.systemUserId) throw new ManualFinalizationError("META_TOKEN_INVALID");
    for (const scope of REQUIRED_SCOPES) {
      if (!inspection.scopes.includes(scope)) throw new ManualFinalizationError("META_PERMISSION_MISSING");
    }
    const wabas = await this.metaTransport.listAssignedWabas(inspection.systemUserId, systemUserToken);
    if (!wabas.some((waba) => waba.id === connection.wabaId)) throw new ManualFinalizationError("META_WABA_ACCESS_MISSING");
    const phones = await this.metaTransport.listPhoneNumbers(connection.wabaId, systemUserToken);
    const selectedPhone = phones.find((phone) => phone.id === connection.phoneNumberId && phone.wabaId === connection.wabaId);
    if (!selectedPhone) throw new ManualFinalizationError("META_PHONE_ACCESS_MISSING");
    await this.ensurePhoneRegistered(tenant, connection, systemUserToken);
    const subscriptions = await this.metaTransport.listWabaSubscriptions(connection.wabaId, systemUserToken);
    const confirmed = subscriptions.some((subscription) => subscription.appId === connection.metaAppId && (!subscription.callbackUrl || subscription.callbackUrl === callbackUrl));
    if (!confirmed) throw new ManualFinalizationError("WEBHOOK_SUBSCRIPTION_UNCONFIRMED");
    recordWhatsAppConnectionAudit("whatsapp_connection.manual_readiness_passed", { sellerId: tenant.sellerId, connectionId: connection.connectionId });
  }

  private async ensurePhoneRegistered(tenant: TenantContext, connection: WhatsAppConnection, systemUserToken: string): Promise<void> {
    if (!connection.phoneNumberId) throw new ManualFinalizationError("META_PHONE_ACCESS_MISSING");
    const existing = await this.metaTransport.readPhoneRegistrationStatus(connection.phoneNumberId, systemUserToken);
    if (existing.id !== connection.phoneNumberId) throw new ManualFinalizationError("META_PHONE_ACCESS_MISSING");
    if (existing.registered) {
      await this.markPhoneRegistration(tenant, connection);
      return;
    }
    const pin = await this.registrationPin(tenant, connection);
    try {
      await this.metaTransport.registerPhoneNumber(connection.phoneNumberId, pin, systemUserToken);
    } catch (error) {
      if (!(error instanceof WhatsAppConnectionMetaTransportError) || error.code !== "unavailable") throw new ManualFinalizationError("META_PHONE_REGISTRATION_FAILED");
      const afterTimeout = await this.metaTransport.readPhoneRegistrationStatus(connection.phoneNumberId, systemUserToken);
      if (afterTimeout.id === connection.phoneNumberId && afterTimeout.registered) {
        await this.markPhoneRegistration(tenant, connection);
        return;
      }
      throw new ManualFinalizationError("META_TRANSIENT_FAILURE");
    }
    const confirmed = await this.metaTransport.readPhoneRegistrationStatus(connection.phoneNumberId, systemUserToken);
    if (confirmed.id !== connection.phoneNumberId || !confirmed.registered) throw new ManualFinalizationError("META_PHONE_REGISTRATION_FAILED");
    await this.markPhoneRegistration(tenant, connection);
  }

  private async registrationPin(tenant: TenantContext, connection: WhatsAppConnection): Promise<string> {
    if (!this.encryptionService) throw new ManualFinalizationError("MANUAL_CONNECTION_NOT_READY");
    const stored = await this.repository.findRegistrationPinStorage(tenant, connection.connectionId);
    if (stored) return this.encryptionService.decryptRegistrationPin(stored.encryptedRegistrationPin);
    const pin = generateRegistrationPin();
    const encrypted = this.encryptionService.encryptRegistrationPin(pin);
    const persisted = await this.repository.persistRegistrationPinCredential(tenant, connection.connectionId, encrypted);
    if (!persisted) throw new WhatsAppConnectionPersistenceError();
    return pin;
  }

  private async markPhoneRegistration(tenant: TenantContext, connection: WhatsAppConnection): Promise<void> {
    const updated = await this.repository.persistFinalizationProgress(tenant, connection.connectionId, { phoneRegistrationCompletedAt: new Date(), clearFinalizationLastError: true });
    if (!updated) throw new WhatsAppConnectionPersistenceError();
    recordWhatsAppConnectionAudit("whatsapp_connection.manual_phone_registration_confirmed", { sellerId: tenant.sellerId, connectionId: connection.connectionId });
  }

  private async activateAtomically(tenant: TenantContext, connectionId: string): Promise<boolean> {
    return this.transactionRunner(async (executor) => {
      const current = assertManualFinalizable(await this.repository.findByConnectionId(tenant, connectionId, { executor }));
      if (current.status === "ACTIVE") return false;
      const assigned = current.phoneNumberId ? await this.repository.resolveByPhoneNumberId(current.phoneNumberId, { executor }) : null;
      if (assigned && assigned.sellerId !== tenant.sellerId) throw new ManualFinalizationError("CONNECTION_ACTIVATION_CONFLICT");
      const active = await this.repository.findActiveBySeller(tenant, { executor });
      if (active && active.connectionId !== current.connectionId) {
        const pending = await this.repository.markReplacementPending(tenant, current.connectionId, active.connectionId, { executor });
        if (!pending) throw new ManualFinalizationError("CONNECTION_ACTIVATION_CONFLICT");
        const replaced = await this.repository.replaceActiveConnection(tenant, active.connectionId, current.connectionId, { executor });
        if (!replaced) throw new ManualFinalizationError("CONNECTION_ACTIVATION_CONFLICT");
        return true;
      }
      const activated = await this.repository.activateConnection(tenant, current.connectionId, { executor });
      if (!activated) throw new ManualFinalizationError("CONNECTION_ACTIVATION_CONFLICT");
      return false;
    });
  }
}

function responseFromConnection(connection: WhatsAppConnection, replacedPreviousConnection: boolean): ManualConnectionFinalizeResult {
  if (!connection.connectedAt) throw new WhatsAppConnectionPersistenceError();
  return {
    connection: {
      connectionId: connection.connectionId,
      status: "ACTIVE",
      connectionMethod: "CUSTOMER_OWNED_META_APP",
      maskedPhoneNumber: maskPhoneNumber(connection.displayPhoneNumber),
      verifiedName: connection.verifiedName ?? null,
      connectedAt: connection.connectedAt.toISOString(),
    },
    health: { status: "HEALTHY" },
    ...(replacedPreviousConnection ? { replacedPreviousConnection: true } : {}),
  };
}

export const __phase11kM4ManualFinalizationTesting = {
  generateRegistrationPin,
  maskPhoneNumber,
};
