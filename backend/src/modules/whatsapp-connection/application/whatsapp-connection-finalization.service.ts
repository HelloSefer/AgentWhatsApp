import { randomInt } from "node:crypto";
import type { DatabaseTransactionExecutor, TenantContext } from "../../../infrastructure/database";
import { withTransaction } from "../../../infrastructure/database/transactions/with-transaction.service";
import type { WhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionActiveAlreadyExistsError,
  WhatsAppConnectionFinalizationAccessDeniedError,
  WhatsAppConnectionFinalizationConflictError,
  WhatsAppConnectionFinalizationRetryableError,
  WhatsAppConnectionFinalizationValidationError,
  WhatsAppConnectionFinalizationVerificationError,
  WhatsAppConnectionMetaTransportError,
  WhatsAppConnectionPersistenceError,
} from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import { normalizeConnectionId } from "../domain/whatsapp-connection.validation";
import { incrementWhatsAppConnectionMetric, recordWhatsAppConnectionAudit } from "./whatsapp-connection-operational-events";
import type { MetaEmbeddedSignupTransport } from "../infrastructure/meta/meta-embedded-signup.transport";
import type { WhatsAppConnectionCredentialService } from "./whatsapp-connection-credential.service";

export type FinalizeWhatsAppConnectionResult = Readonly<{
  finalized: true;
  connection: Readonly<{
    connectionId: string;
    status: "VERIFYING" | "ACTIVE";
    phoneRegistrationCompleted: boolean;
    wabaSubscriptionCompleted: boolean;
    connectedAt: Date | null;
    lastVerifiedAt: Date | null;
  }>;
}>;

export type TransactionRunner = <Result>(callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>) => Promise<Result>;

type SafeFinalizationErrorCode =
  | "missing_access_token"
  | "invalid_access_token"
  | "invalid_connection_state"
  | "missing_meta_assets"
  | "missing_finalization_marker"
  | "phone_registration_rejected"
  | "phone_registration_timeout"
  | "phone_registration_unconfirmed"
  | "waba_subscription_rejected"
  | "waba_subscription_timeout"
  | "waba_subscription_unconfirmed"
  | "meta_permission_denied"
  | "malformed_meta_response"
  | "persistence_failure";

function generateRegistrationPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function assertRegistrationPin(value: string): string {
  if (!/^\d{6}$/u.test(value)) throw new WhatsAppConnectionCredentialEncryptionError();
  return value;
}

function safeErrorFromMeta(error: WhatsAppConnectionMetaTransportError, operation: "registration" | "subscription"): { code: SafeFinalizationErrorCode; error: Error } {
  if (error.code === "auth") return { code: "meta_permission_denied", error: new WhatsAppConnectionFinalizationAccessDeniedError() };
  if (error.code === "unavailable") {
    return {
      code: operation === "registration" ? "phone_registration_timeout" : "waba_subscription_timeout",
      error: new WhatsAppConnectionFinalizationRetryableError(),
    };
  }
  if (error.code === "validation") {
    return {
      code: operation === "registration" ? "phone_registration_rejected" : "waba_subscription_rejected",
      error: new WhatsAppConnectionFinalizationVerificationError(),
    };
  }
  return { code: "malformed_meta_response", error: new WhatsAppConnectionFinalizationVerificationError() };
}

export class WhatsAppConnectionFinalizationService {
  constructor(
    private readonly repository: WhatsAppConnectionRepository,
    private readonly credentialService: WhatsAppConnectionCredentialService | null,
    private readonly metaTransport: MetaEmbeddedSignupTransport,
    private readonly transactionRunner: TransactionRunner = withTransaction,
  ) {}

  async finalize(tenant: TenantContext, connectionId: string): Promise<FinalizeWhatsAppConnectionResult> {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    if (!this.credentialService) throw new WhatsAppConnectionFinalizationAccessDeniedError();
    const initial = await this.loadActivatableConnection(tenant, normalizedConnectionId);
    if (initial.status === "ACTIVE") return responseFromConnection(initial);

    const active = await this.repository.findActiveBySeller(tenant);
    if (active && active.connectionId !== initial.connectionId && initial.status !== "REPLACEMENT_PENDING") {
      throw new WhatsAppConnectionFinalizationConflictError();
    }

    const accessToken = await this.decryptAccessToken(tenant, initial);
    const withRegistration = initial.phoneRegistrationCompletedAt
      ? initial
      : await this.ensurePhoneRegistration(tenant, initial, accessToken);
    const withSubscription = withRegistration.wabaSubscriptionCompletedAt
      ? withRegistration
      : await this.ensureWabaSubscription(tenant, withRegistration, accessToken);
    const cleared = await this.repository.persistFinalizationProgress(tenant, withSubscription.connectionId, { clearFinalizationLastError: true });
    if (!cleared) throw new WhatsAppConnectionPersistenceError();

    return this.activateReadyConnection(tenant, cleared.connectionId);
  }

  async activateReadyConnection(tenant: TenantContext, connectionId: string): Promise<FinalizeWhatsAppConnectionResult> {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    if (!this.credentialService) throw new WhatsAppConnectionFinalizationAccessDeniedError();
    const connection = await this.loadActivatableConnection(tenant, normalizedConnectionId);
    if (connection.status === "ACTIVE") return responseFromConnection(connection);

    const active = await this.repository.findActiveBySeller(tenant);
    if (active && active.connectionId !== connection.connectionId && connection.status !== "REPLACEMENT_PENDING") {
      throw new WhatsAppConnectionFinalizationConflictError();
    }

    const accessToken = await this.decryptAccessToken(tenant, connection);
    await this.verifyReadiness(tenant, connection, accessToken);
    const activated = await this.activateAtomically(tenant, connection.connectionId);
    return responseFromConnection(activated);
  }

  private normalizeConnectionId(connectionId: string): string {
    try {
      return normalizeConnectionId(connectionId);
    } catch {
      throw new WhatsAppConnectionFinalizationValidationError();
    }
  }

  private async loadActivatableConnection(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection> {
    const connection = await this.repository.findByConnectionId(tenant, connectionId);
    if (!connection) throw new WhatsAppConnectionFinalizationConflictError();
    if (connection.status === "ACTIVE") return connection;
    if (connection.status !== "VERIFYING" && connection.status !== "REPLACEMENT_PENDING") {
      await this.persistSafeError(tenant, connection.connectionId, "invalid_connection_state");
      throw new WhatsAppConnectionFinalizationConflictError();
    }
    if (!connection.phoneNumberId || !connection.wabaId) {
      await this.persistSafeError(tenant, connection.connectionId, "missing_meta_assets");
      throw new WhatsAppConnectionFinalizationVerificationError();
    }
    return connection;
  }

  private async decryptAccessToken(tenant: TenantContext, connection: WhatsAppConnection): Promise<string> {
    if (!this.credentialService) throw new WhatsAppConnectionFinalizationAccessDeniedError();
    try {
      const storage = await this.credentialService.getCredentialStorage(tenant, connection.connectionId);
      if (!storage?.encryptedAccessToken) {
        await this.persistSafeError(tenant, connection.connectionId, "missing_access_token");
        recordWhatsAppConnectionAudit("whatsapp_connection.token_invalid", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "token_invalid" });
        incrementWhatsAppConnectionMetric("whatsapp_connection_token_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "token_invalid" });
        throw new WhatsAppConnectionFinalizationAccessDeniedError();
      }
      if (storage.tokenExpiresAt && storage.tokenExpiresAt.getTime() <= Date.now()) {
        await this.persistSafeError(tenant, connection.connectionId, "invalid_access_token");
        recordWhatsAppConnectionAudit("whatsapp_connection.token_invalid", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "token_invalid" });
        incrementWhatsAppConnectionMetric("whatsapp_connection_token_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "token_invalid" });
        throw new WhatsAppConnectionFinalizationAccessDeniedError();
      }
      const token = await this.credentialService.decryptStoredAccessToken(tenant, connection.connectionId);
      if (!token) throw new WhatsAppConnectionCredentialEncryptionError();
      return token;
    } catch (error) {
      if (error instanceof WhatsAppConnectionFinalizationAccessDeniedError) throw error;
      await this.persistSafeError(tenant, connection.connectionId, "invalid_access_token");
      recordWhatsAppConnectionAudit("whatsapp_connection.token_invalid", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "credential_decryption_failed" });
      incrementWhatsAppConnectionMetric("whatsapp_connection_token_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "credential_decryption_failed" });
      throw new WhatsAppConnectionFinalizationAccessDeniedError();
    }
  }

  private async ensureRegistrationPin(tenant: TenantContext, connection: WhatsAppConnection): Promise<string> {
    if (!this.credentialService) throw new WhatsAppConnectionFinalizationAccessDeniedError();
    const stored = await this.credentialService.decryptStoredRegistrationPin(tenant, connection.connectionId);
    if (stored) return assertRegistrationPin(stored);

    const generated = generateRegistrationPin();
    const persisted = await this.credentialService.storeRegistrationPin(tenant, connection.connectionId, generated);
    if (!persisted) throw new WhatsAppConnectionPersistenceError();
    return generated;
  }

  private async ensurePhoneRegistration(tenant: TenantContext, connection: WhatsAppConnection, accessToken: string): Promise<WhatsAppConnection> {
    const phoneNumberId = connection.phoneNumberId;
    if (!phoneNumberId) throw new WhatsAppConnectionFinalizationVerificationError();
    const registrationPin = await this.ensureRegistrationPin(tenant, connection);

    const alreadyRegistered = await this.readPhoneRegistration(tenant, connection, accessToken);
    if (alreadyRegistered) return this.markPhoneRegistered(tenant, connection);

    try {
      await this.metaTransport.registerPhoneNumber(phoneNumberId, registrationPin, accessToken);
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) {
        const safe = safeErrorFromMeta(error, "registration");
        await this.persistSafeError(tenant, connection.connectionId, safe.code);
        throw safe.error;
      }
      await this.persistSafeError(tenant, connection.connectionId, "phone_registration_timeout");
      throw new WhatsAppConnectionFinalizationRetryableError();
    }

    const confirmed = await this.readPhoneRegistration(tenant, connection, accessToken);
    if (!confirmed) {
      await this.persistSafeError(tenant, connection.connectionId, "phone_registration_unconfirmed");
      throw new WhatsAppConnectionFinalizationRetryableError();
    }
    return this.markPhoneRegistered(tenant, connection);
  }

  private async ensureWabaSubscription(tenant: TenantContext, connection: WhatsAppConnection, accessToken: string): Promise<WhatsAppConnection> {
    const wabaId = connection.wabaId;
    if (!wabaId) throw new WhatsAppConnectionFinalizationVerificationError();

    const alreadySubscribed = await this.readWabaSubscription(tenant, connection, accessToken);
    if (alreadySubscribed) return this.markWabaSubscribed(tenant, connection);

    try {
      await this.metaTransport.subscribeWabaToWebhooks(wabaId, accessToken);
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) {
        const safe = safeErrorFromMeta(error, "subscription");
        await this.persistSafeError(tenant, connection.connectionId, safe.code);
        throw safe.error;
      }
      await this.persistSafeError(tenant, connection.connectionId, "waba_subscription_timeout");
      throw new WhatsAppConnectionFinalizationRetryableError();
    }

    const confirmed = await this.readWabaSubscription(tenant, connection, accessToken);
    if (!confirmed) {
      await this.persistSafeError(tenant, connection.connectionId, "waba_subscription_unconfirmed");
      throw new WhatsAppConnectionFinalizationRetryableError();
    }
    return this.markWabaSubscribed(tenant, connection);
  }

  private async readPhoneRegistration(tenant: TenantContext, connection: WhatsAppConnection, accessToken: string): Promise<boolean> {
    if (!connection.phoneNumberId) return false;
    try {
      const result = await this.metaTransport.readPhoneNumberRegistrationStatus(connection.phoneNumberId, accessToken);
      if (result.id !== connection.phoneNumberId) throw new WhatsAppConnectionMetaTransportError("not_found");
      return result.registered;
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) {
        const safe = safeErrorFromMeta(error, "registration");
        await this.persistSafeError(tenant, connection.connectionId, safe.code);
        throw safe.error;
      }
      await this.persistSafeError(tenant, connection.connectionId, "malformed_meta_response");
      throw new WhatsAppConnectionFinalizationVerificationError();
    }
  }

  private async readWabaSubscription(tenant: TenantContext, connection: WhatsAppConnection, accessToken: string): Promise<boolean> {
    if (!connection.wabaId) return false;
    try {
      const result = await this.metaTransport.readWabaWebhookSubscriptionStatus(connection.wabaId, accessToken);
      if (result.wabaId !== connection.wabaId) throw new WhatsAppConnectionMetaTransportError("not_found");
      return result.subscribed;
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) {
        const safe = safeErrorFromMeta(error, "subscription");
        await this.persistSafeError(tenant, connection.connectionId, safe.code);
        throw safe.error;
      }
      await this.persistSafeError(tenant, connection.connectionId, "malformed_meta_response");
      throw new WhatsAppConnectionFinalizationVerificationError();
    }
  }

  private async markPhoneRegistered(tenant: TenantContext, connection: WhatsAppConnection): Promise<WhatsAppConnection> {
    const updated = await this.repository.persistFinalizationProgress(tenant, connection.connectionId, {
      phoneRegistrationCompletedAt: new Date(),
      clearFinalizationLastError: true,
    });
    if (!updated) throw new WhatsAppConnectionPersistenceError();
    return updated;
  }

  private async markWabaSubscribed(tenant: TenantContext, connection: WhatsAppConnection): Promise<WhatsAppConnection> {
    const updated = await this.repository.persistFinalizationProgress(tenant, connection.connectionId, {
      wabaSubscriptionCompletedAt: new Date(),
      clearFinalizationLastError: true,
    });
    if (!updated) throw new WhatsAppConnectionPersistenceError();
    return updated;
  }

  private async persistSafeError(tenant: TenantContext, connectionId: string, code: SafeFinalizationErrorCode): Promise<void> {
    const updated = await this.repository.persistFinalizationProgress(tenant, connectionId, { finalizationLastErrorCode: code });
    if (!updated) throw new WhatsAppConnectionPersistenceError();
  }

  private async verifyReadiness(tenant: TenantContext, connection: WhatsAppConnection, accessToken: string): Promise<void> {
    if (!connection.wabaId || !connection.phoneNumberId) {
      await this.persistSafeError(tenant, connection.connectionId, "missing_meta_assets");
      throw new WhatsAppConnectionFinalizationVerificationError();
    }
    if (!connection.phoneRegistrationCompletedAt || !connection.wabaSubscriptionCompletedAt) {
      await this.persistSafeError(tenant, connection.connectionId, "missing_finalization_marker");
      throw new WhatsAppConnectionFinalizationVerificationError();
    }

    try {
      const inspection = await this.metaTransport.inspectToken(accessToken);
      if (!inspection.valid) throw new WhatsAppConnectionMetaTransportError("auth");

      const waba = await this.metaTransport.readWaba(connection.wabaId, accessToken);
      if (waba.id !== connection.wabaId) throw new WhatsAppConnectionMetaTransportError("not_found");

      const phone = await this.metaTransport.readPhoneNumber(connection.phoneNumberId, accessToken);
      if (phone.id !== connection.phoneNumberId || phone.wabaId !== connection.wabaId) {
        throw new WhatsAppConnectionMetaTransportError("not_found");
      }

      const registered = await this.metaTransport.readPhoneNumberRegistrationStatus(connection.phoneNumberId, accessToken);
      if (registered.id !== connection.phoneNumberId || !registered.registered) {
        await this.persistSafeError(tenant, connection.connectionId, "phone_registration_unconfirmed");
        throw new WhatsAppConnectionFinalizationVerificationError();
      }

      const subscription = await this.metaTransport.readWabaWebhookSubscriptionStatus(connection.wabaId, accessToken);
      if (subscription.wabaId !== connection.wabaId || !subscription.subscribed) {
        await this.persistSafeError(tenant, connection.connectionId, "waba_subscription_unconfirmed");
        throw new WhatsAppConnectionFinalizationVerificationError();
      }
    } catch (error) {
      if (
        error instanceof WhatsAppConnectionFinalizationVerificationError ||
        error instanceof WhatsAppConnectionFinalizationAccessDeniedError ||
        error instanceof WhatsAppConnectionFinalizationRetryableError
      ) {
        throw error;
      }
      if (error instanceof WhatsAppConnectionMetaTransportError) {
        const safe = safeErrorFromMeta(error, "registration");
        await this.persistSafeError(tenant, connection.connectionId, safe.code);
        throw safe.error;
      }
      await this.persistSafeError(tenant, connection.connectionId, "malformed_meta_response");
      throw new WhatsAppConnectionFinalizationVerificationError();
    }
  }

  private async activateAtomically(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnection> {
    try {
      return await this.transactionRunner(async (executor) => {
        const connection = await this.repository.findByConnectionId(tenant, connectionId, { executor });
        if (!connection) throw new WhatsAppConnectionFinalizationConflictError();
        if (connection.status === "ACTIVE") return connection;
        if (connection.status !== "VERIFYING" && connection.status !== "REPLACEMENT_PENDING") throw new WhatsAppConnectionFinalizationConflictError();

        const active = await this.repository.findActiveBySeller(tenant, { executor });
        if (active && active.connectionId !== connection.connectionId) {
          if (connection.status !== "REPLACEMENT_PENDING") throw new WhatsAppConnectionFinalizationConflictError();
          const replaced = await this.repository.replaceActiveConnection(tenant, active.connectionId, connection.connectionId, { executor });
          if (!replaced) throw new WhatsAppConnectionFinalizationConflictError();
          recordWhatsAppConnectionAudit("whatsapp_connection.replaced", { sellerId: tenant.sellerId, connectionId: replaced.connectionId, status: replaced.status });
          incrementWhatsAppConnectionMetric("whatsapp_connections_active_total", { sellerId: tenant.sellerId, connectionId: replaced.connectionId, status: replaced.status });
          return replaced;
        }

        const activated = await this.repository.activateConnection(tenant, connection.connectionId, { executor });
        if (!activated) throw new WhatsAppConnectionPersistenceError();
        recordWhatsAppConnectionAudit("whatsapp_connection.activated", { sellerId: tenant.sellerId, connectionId: activated.connectionId, status: activated.status });
        incrementWhatsAppConnectionMetric("whatsapp_connections_active_total", { sellerId: tenant.sellerId, connectionId: activated.connectionId, status: activated.status });
        return activated;
      });
    } catch (error) {
      if (error instanceof WhatsAppConnectionActiveAlreadyExistsError) throw new WhatsAppConnectionFinalizationConflictError();
      if (
        error instanceof WhatsAppConnectionFinalizationConflictError ||
        error instanceof WhatsAppConnectionPersistenceError
      ) throw error;
      throw new WhatsAppConnectionPersistenceError(error);
    }
  }
}

function responseFromConnection(connection: WhatsAppConnection): FinalizeWhatsAppConnectionResult {
  return {
    finalized: true,
    connection: {
      connectionId: connection.connectionId,
      status: connection.status === "ACTIVE" ? "ACTIVE" : "VERIFYING",
      phoneRegistrationCompleted: Boolean(connection.phoneRegistrationCompletedAt),
      wabaSubscriptionCompleted: Boolean(connection.wabaSubscriptionCompletedAt),
      connectedAt: connection.connectedAt ?? null,
      lastVerifiedAt: connection.lastVerifiedAt ?? null,
    },
  };
}

export const __phase11e1Testing = {
  generateRegistrationPin,
};
