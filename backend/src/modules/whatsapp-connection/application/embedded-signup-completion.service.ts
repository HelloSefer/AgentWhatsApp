import type { DatabaseTransactionExecutor, TenantContext } from "../../../infrastructure/database";
import { withTransaction } from "../../../infrastructure/database/transactions/with-transaction.service";
import type { WhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  WhatsAppConnectionActiveAlreadyExistsError,
  WhatsAppConnectionCompletionAccessDeniedError,
  WhatsAppConnectionCompletionConflictError,
  WhatsAppConnectionCompletionValidationError,
  WhatsAppConnectionCompletionVerificationError,
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionMetaConfigurationError,
  WhatsAppConnectionMetaTransportError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionPhoneNumberAlreadyAssignedError,
} from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import { normalizeMetaId } from "../domain/whatsapp-connection.validation";
import type { MetaEmbeddedSignupConfiguration } from "./meta-embedded-signup.config";
import { incrementWhatsAppConnectionMetric, observeWhatsAppConnectionMetric, recordWhatsAppConnectionAudit, type SafeWhatsAppConnectionReason } from "./whatsapp-connection-operational-events";
import type { WhatsAppConnectionCredentialService } from "./whatsapp-connection-credential.service";
import type { MetaEmbeddedSignupTransport, MetaPhoneNumberResult, MetaTokenInspectionResult, MetaWabaResult } from "../infrastructure/meta/meta-embedded-signup.transport";

export type CompleteEmbeddedSignupInput = Readonly<{
  code: string;
  wabaId: string;
  phoneNumberId: string;
}>;

export type CompleteEmbeddedSignupResult = Readonly<{
  verified: true;
  connection: Readonly<{
    connectionId: string;
    status: "VERIFYING" | "REPLACEMENT_PENDING";
    displayPhoneNumber: string | null;
    verifiedName: string | null;
  }>;
}>;

export type TransactionRunner = <Result>(callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>) => Promise<Result>;

const REQUIRED_SCOPES = new Set(["whatsapp_business_management", "whatsapp_business_messaging"]);

function requiredBoundedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new WhatsAppConnectionCompletionValidationError();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new WhatsAppConnectionCompletionValidationError();
  return trimmed;
}

function normalizeInput(input: CompleteEmbeddedSignupInput): CompleteEmbeddedSignupInput {
  return {
    code: requiredBoundedString(input.code, 2048),
    wabaId: normalizeMetaId(requiredBoundedString(input.wabaId, 128)) ?? "",
    phoneNumberId: normalizeMetaId(requiredBoundedString(input.phoneNumberId, 128)) ?? "",
  };
}

function tokenHasRequiredAccess(inspection: MetaTokenInspectionResult, appId: string): boolean {
  if (!inspection.valid) return false;
  if (inspection.appId && inspection.appId !== appId) return false;
  if (!inspection.scopes.length) return true;
  return [...REQUIRED_SCOPES].every((scope) => inspection.scopes.includes(scope));
}

function verifyMetaAssets(input: CompleteEmbeddedSignupInput, waba: MetaWabaResult, phone: MetaPhoneNumberResult): void {
  if (waba.id !== input.wabaId || phone.id !== input.phoneNumberId || phone.wabaId !== input.wabaId) {
    throw new WhatsAppConnectionCompletionVerificationError();
  }
}

function safePersistenceError(error: unknown): never {
  if (error instanceof WhatsAppConnectionActiveAlreadyExistsError) throw new WhatsAppConnectionCompletionConflictError();
  if (error instanceof WhatsAppConnectionPhoneNumberAlreadyAssignedError) throw new WhatsAppConnectionCompletionConflictError();
  if (error instanceof WhatsAppConnectionCompletionConflictError) throw error;
  throw new WhatsAppConnectionPersistenceError(error);
}

function reasonFromCompletionError(error: unknown): SafeWhatsAppConnectionReason {
  if (error instanceof WhatsAppConnectionCompletionAccessDeniedError) return "token_invalid";
  if (error instanceof WhatsAppConnectionCompletionConflictError) return "conflict";
  if (error instanceof WhatsAppConnectionCompletionValidationError) return "invalid_request";
  if (error instanceof WhatsAppConnectionMetaConfigurationError) return "missing_configuration";
  if (error instanceof WhatsAppConnectionCredentialEncryptionError) return "credential_unavailable";
  if (error instanceof WhatsAppConnectionPersistenceError) return "persistence_failure";
  return "verification_failed";
}

export class EmbeddedSignupCompletionService {
  constructor(
    private readonly repository: WhatsAppConnectionRepository,
    private readonly credentialService: WhatsAppConnectionCredentialService | null,
    private readonly metaTransport: MetaEmbeddedSignupTransport,
    private readonly metaConfiguration: MetaEmbeddedSignupConfiguration | null,
    private readonly transactionRunner: TransactionRunner = withTransaction,
  ) {}

  async complete(tenant: TenantContext, rawInput: CompleteEmbeddedSignupInput): Promise<CompleteEmbeddedSignupResult> {
    const startedAt = Date.now();
    if (!this.metaConfiguration) {
      recordWhatsAppConnectionAudit("whatsapp_connection.verification_failed", { sellerId: tenant.sellerId, reason: "missing_configuration" });
      incrementWhatsAppConnectionMetric("whatsapp_connection_failures_total", { sellerId: tenant.sellerId, reason: "missing_configuration" });
      throw new WhatsAppConnectionMetaConfigurationError();
    }
    if (!this.credentialService) {
      recordWhatsAppConnectionAudit("whatsapp_connection.verification_failed", { sellerId: tenant.sellerId, reason: "credential_unavailable" });
      incrementWhatsAppConnectionMetric("whatsapp_connection_failures_total", { sellerId: tenant.sellerId, reason: "credential_unavailable" });
      throw new WhatsAppConnectionCredentialEncryptionError();
    }
    const credentialService = this.credentialService;
    const input = normalizeInput(rawInput);

    const assigned = await this.repository.resolveByPhoneNumberId(input.phoneNumberId);
    if (assigned && assigned.sellerId !== tenant.sellerId) throw new WhatsAppConnectionCompletionConflictError();
    if (assigned?.connection.status === "ACTIVE") throw new WhatsAppConnectionCompletionConflictError();
    if (assigned?.connection.status === "VERIFYING" || assigned?.connection.status === "REPLACEMENT_PENDING") {
      const stored = await this.repository.findCredentialStorage(tenant, assigned.connection.connectionId);
      if (stored) return responseFromConnection(assigned.connection);
    }

    let exchange;
    try {
      exchange = await this.metaTransport.exchangeCode(input.code);
      const inspection = await this.metaTransport.inspectToken(exchange.accessToken);
      if (!tokenHasRequiredAccess(inspection, this.metaConfiguration.appId)) {
        throw new WhatsAppConnectionCompletionAccessDeniedError();
      }
      const waba = await this.metaTransport.readWaba(input.wabaId, exchange.accessToken);
      const phone = await this.metaTransport.readPhoneNumber(input.phoneNumberId, exchange.accessToken);
      verifyMetaAssets(input, waba, phone);

      const result = await this.persistCompletion(tenant, input, phone, exchange.accessToken, exchange.tokenExpiresAt ?? null, credentialService);
      recordWhatsAppConnectionAudit("whatsapp_connection.signup_completed", {
        sellerId: tenant.sellerId,
        connectionId: result.connection.connectionId,
        status: result.connection.status,
      });
      if (result.connection.status === "REPLACEMENT_PENDING") {
        recordWhatsAppConnectionAudit("whatsapp_connection.replacement_started", {
          sellerId: tenant.sellerId,
          connectionId: result.connection.connectionId,
          status: result.connection.status,
        });
      }
      observeWhatsAppConnectionMetric("whatsapp_connection_signup_completion_duration", Date.now() - startedAt, {
        sellerId: tenant.sellerId,
        connectionId: result.connection.connectionId,
        status: result.connection.status,
      });
      return result;
    } catch (error) {
      const reason = reasonFromCompletionError(error);
      recordWhatsAppConnectionAudit("whatsapp_connection.verification_failed", { sellerId: tenant.sellerId, reason });
      incrementWhatsAppConnectionMetric("whatsapp_connection_failures_total", { sellerId: tenant.sellerId, reason });
      if (reason === "token_invalid") {
        recordWhatsAppConnectionAudit("whatsapp_connection.token_invalid", { sellerId: tenant.sellerId, reason });
        incrementWhatsAppConnectionMetric("whatsapp_connection_token_failures_total", { sellerId: tenant.sellerId, reason });
      }
      if (
        error instanceof WhatsAppConnectionCompletionAccessDeniedError ||
        error instanceof WhatsAppConnectionCompletionConflictError ||
        error instanceof WhatsAppConnectionCompletionValidationError ||
        error instanceof WhatsAppConnectionCompletionVerificationError ||
        error instanceof WhatsAppConnectionMetaConfigurationError ||
        error instanceof WhatsAppConnectionPersistenceError
      ) {
        throw error;
      }
      if (error instanceof WhatsAppConnectionMetaTransportError) {
        if (error.code === "auth" || error.code === "validation") throw new WhatsAppConnectionCompletionVerificationError();
        if (error.code === "not_found") throw new WhatsAppConnectionCompletionVerificationError();
      }
      throw new WhatsAppConnectionCompletionVerificationError();
    }
  }

  private async persistCompletion(
    tenant: TenantContext,
    input: CompleteEmbeddedSignupInput,
    phone: MetaPhoneNumberResult,
    accessToken: string,
    tokenExpiresAt: Date | null,
    credentialService: WhatsAppConnectionCredentialService,
  ): Promise<CompleteEmbeddedSignupResult> {
    try {
      const connection = await this.transactionRunner(async (executor) => {
        const existingActive = await this.repository.findActiveBySeller(tenant, { executor });

        const assigned = await this.repository.resolveByPhoneNumberId(input.phoneNumberId, { executor });
        if (assigned && assigned.sellerId !== tenant.sellerId) throw new WhatsAppConnectionCompletionConflictError();
        if (assigned?.connection.status === "ACTIVE") throw new WhatsAppConnectionCompletionConflictError();

        const existing = await this.repository.findByPhoneNumberIdForSeller(tenant, input.phoneNumberId, { executor });
        const candidate = existing ?? await this.repository.createCandidate(tenant, undefined, { executor });
        if (candidate.status === "ACTIVE") throw new WhatsAppConnectionCompletionConflictError();

        const withMetadata = await this.repository.persistVerifiedMetadata(tenant, candidate.connectionId, {
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayPhoneNumber: phone.displayPhoneNumber ?? null,
          verifiedName: phone.verifiedName ?? null,
        }, { executor });
        if (!withMetadata) throw new WhatsAppConnectionPersistenceError();

        const verifying = existingActive && existingActive.connectionId !== candidate.connectionId
          ? await this.repository.markReplacementPending(tenant, candidate.connectionId, existingActive.connectionId, { executor })
          : await this.repository.updateLifecycleStatus(tenant, candidate.connectionId, "VERIFYING", { executor });
        if (!verifying) throw new WhatsAppConnectionPersistenceError();

        const stored = await credentialService.storeAccessToken(tenant, candidate.connectionId, { accessToken, tokenExpiresAt }, { executor });
        if (!stored) throw new WhatsAppConnectionPersistenceError();

        return verifying;
      });

      return responseFromConnection(connection);
    } catch (error) {
      safePersistenceError(error);
    }
  }
}

function responseFromConnection(connection: WhatsAppConnection): CompleteEmbeddedSignupResult {
  return {
    verified: true,
    connection: {
      connectionId: connection.connectionId,
      status: connection.status === "REPLACEMENT_PENDING" ? "REPLACEMENT_PENDING" : "VERIFYING",
      displayPhoneNumber: connection.displayPhoneNumber ?? null,
      verifiedName: connection.verifiedName ?? null,
    },
  };
}
