import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseTransactionExecutor, TenantContext } from "../../../infrastructure/database";
import { withTransaction } from "../../../infrastructure/database";
import type { ManualWhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  ManualConnectionCredentialReplacementForbiddenError,
  ManualConnectionValidationError,
  ManualConnectionSetupEncryptionUnavailableError,
  WhatsAppConnectionCompletionConflictError,
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionMetaTransportError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionValidationError,
  manualMetaTransportIssueCode,
} from "../domain/whatsapp-connection.errors";
import type { PersistManualWhatsAppConnectionCredentialInput } from "../domain/whatsapp-connection-credentials.types";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import {
  normalizeConnectionId,
  normalizeManualMetaAppSecret,
  normalizeManualSystemUserAccessToken,
  normalizeMetaAppId,
} from "../domain/whatsapp-connection.validation";
import type { ManualMetaAppTransport } from "../infrastructure/meta/manual-meta-app.transport";
import { missingManualSystemUserRequiredScope } from "./manual-system-user-token-validation";
import {
  recordWhatsAppConnectionAudit,
  type ManualConnectionSetupErrorCode,
  type ManualConnectionSetupOperationStage,
  type SafeWhatsAppConnectionReason,
} from "./whatsapp-connection-operational-events";
import type { WhatsAppConnectionCredentialEncryptionService } from "./whatsapp-connection-credential-encryption.service";

export type ManualConnectionSetupInput = Readonly<{
  appId: string;
  appSecret: string;
  systemUserAccessToken: string;
}>;

export type ManualConnectionSetupResult = Readonly<{
  connection: Readonly<{
    connectionId: string;
    status: "PENDING";
    connectionMethod: "CUSTOMER_OWNED_META_APP";
    appId: string;
  }>;
  webhookSetup: Readonly<{
    callbackPath: string;
    verifyToken: string;
  }>;
}>;

export type ManualConnectionTransactionRunner = <Result>(callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>) => Promise<Result>;

type PreparedManualConnectionCredentials = Readonly<{
  appId: string;
  credential: PersistManualWhatsAppConnectionCredentialInput;
  verifyToken: string;
}>;

const REPLACEABLE_MANUAL_CONNECTION_STATUSES = new Set([
  "PENDING",
  "VERIFYING",
  "REPLACEMENT_PENDING",
  "ERROR",
]);

function generateWebhookVerifyToken(): string {
  return randomBytes(32).toString("base64url");
}

function generatePublicWebhookId(): string {
  return randomUUID().replace(/-/gu, "");
}

function rethrowSafeSetupError(error: unknown): never {
  if (
    error instanceof WhatsAppConnectionValidationError ||
    error instanceof ManualConnectionValidationError ||
    error instanceof ManualConnectionCredentialReplacementForbiddenError ||
    error instanceof WhatsAppConnectionCompletionConflictError
  ) throw error;
  if (error instanceof WhatsAppConnectionCredentialEncryptionError) throw error;
  throw new WhatsAppConnectionPersistenceError(error);
}

function setupFailureReason(error: unknown): SafeWhatsAppConnectionReason {
  if (error instanceof WhatsAppConnectionValidationError) return "invalid_request";
  if (error instanceof ManualConnectionValidationError) {
    return error.issueCode === "META_TOKEN_INVALID" ? "token_invalid" : "verification_failed";
  }
  if (
    error instanceof WhatsAppConnectionCompletionConflictError ||
    error instanceof ManualConnectionCredentialReplacementForbiddenError
  ) return "conflict";
  if (error instanceof WhatsAppConnectionCredentialEncryptionError) return "credential_unavailable";
  return "persistence_failure";
}

function setupFailureCode(error: unknown): ManualConnectionSetupErrorCode {
  return error instanceof ManualConnectionSetupEncryptionUnavailableError
    ? "WHATSAPP_CREDENTIAL_ENCRYPTION_UNAVAILABLE"
    : "MANUAL_CONNECTION_SETUP_FAILED";
}

function setupResponse(connection: WhatsAppConnection, verifyToken: string): ManualConnectionSetupResult {
  if (connection.status !== "PENDING" || connection.connectionMethod !== "CUSTOMER_OWNED_META_APP" || !connection.metaAppId || !connection.publicWebhookId) {
    throw new WhatsAppConnectionPersistenceError();
  }
  return {
    connection: {
      connectionId: connection.connectionId,
      status: "PENDING",
      connectionMethod: "CUSTOMER_OWNED_META_APP",
      appId: connection.metaAppId,
    },
    webhookSetup: {
      callbackPath: `/api/whatsapp/webhooks/connections/${connection.publicWebhookId}`,
      verifyToken,
    },
  };
}

function assertReplaceableManualConnection(connection: WhatsAppConnection | null): WhatsAppConnection {
  if (
    connection?.connectionMethod === "CUSTOMER_OWNED_META_APP" &&
    connection.status === "ACTIVE"
  ) {
    throw new ManualConnectionCredentialReplacementForbiddenError();
  }
  if (
    !connection ||
    connection.connectionMethod !== "CUSTOMER_OWNED_META_APP" ||
    !REPLACEABLE_MANUAL_CONNECTION_STATUSES.has(connection.status)
  ) {
    throw new WhatsAppConnectionCompletionConflictError();
  }
  return connection;
}

export class ManualConnectionSetupService {
  constructor(
    private readonly repository: ManualWhatsAppConnectionRepository,
    private readonly encryptionService: WhatsAppConnectionCredentialEncryptionService | null,
    private readonly metaTransport: ManualMetaAppTransport,
    private readonly transactionRunner: ManualConnectionTransactionRunner = withTransaction,
  ) {}

  async setup(tenant: TenantContext, rawInput: ManualConnectionSetupInput): Promise<ManualConnectionSetupResult> {
    let stage: ManualConnectionSetupOperationStage = "encryption_service_initialization";
    let draftMode: "create" | "reuse" | "unknown" = "unknown";

    try {
      if (!this.encryptionService) throw new ManualConnectionSetupEncryptionUnavailableError();
      const prepared = await this.prepareCredentials(rawInput, (nextStage) => {
        stage = nextStage;
      });

      stage = "transaction_commit";
      const connection = await this.transactionRunner(async (executor) => {
        stage = "existing_draft_lookup";
        const existing = await this.repository.findReusableManualDraft(tenant, prepared.appId, { executor });
        draftMode = existing ? "reuse" : "create";
        if (existing) {
          stage = "credential_persistence";
          const reset = await this.repository.replaceManualCredentialsAndResetState(tenant, existing.connectionId, {
            metaAppId: prepared.appId,
            ...prepared.credential,
          }, { executor });
          if (!reset) throw new WhatsAppConnectionCompletionConflictError();
          return reset;
        }

        stage = "draft_create";
        const draft = await this.repository.createManualDraft(tenant, {
          metaAppId: prepared.appId,
          publicWebhookId: generatePublicWebhookId(),
        }, { executor });
        stage = "credential_persistence";
        const stored = await this.repository.persistManualCredentials(tenant, draft.connectionId, prepared.credential, { executor });
        if (!stored) throw new WhatsAppConnectionPersistenceError();
        return draft;
      });

      stage = "safe_response_mapping";
      return setupResponse(connection, prepared.verifyToken);
    } catch (error) {
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_setup_failed", {
        connectionMethod: "CUSTOMER_OWNED_META_APP",
        operationStage: stage,
        errorCode: setupFailureCode(error),
        draftMode,
        reason: setupFailureReason(error),
      });
      rethrowSafeSetupError(error);
    }
  }

  async replaceCredentials(tenant: TenantContext, connectionId: string, rawInput: ManualConnectionSetupInput): Promise<ManualConnectionSetupResult> {
    let stage: ManualConnectionSetupOperationStage = "encryption_service_initialization";
    let draftMode: "create" | "reuse" | "unknown" = "unknown";

    try {
      if (!this.encryptionService) throw new ManualConnectionSetupEncryptionUnavailableError();
      stage = "existing_draft_lookup";
      const existing = assertReplaceableManualConnection(
        await this.repository.findByConnectionId(tenant, normalizeConnectionId(connectionId)),
      );
      draftMode = "reuse";

      const prepared = await this.prepareCredentials(rawInput, (nextStage) => {
        stage = nextStage;
      });
      stage = "credential_persistence";
      const replaced = await this.repository.replaceManualCredentialsAndResetState(tenant, existing.connectionId, {
        metaAppId: prepared.appId,
        ...prepared.credential,
      });
      if (!replaced) throw new WhatsAppConnectionCompletionConflictError();

      stage = "safe_response_mapping";
      return setupResponse(replaced, prepared.verifyToken);
    } catch (error) {
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_setup_failed", {
        connectionMethod: "CUSTOMER_OWNED_META_APP",
        operationStage: stage,
        errorCode: setupFailureCode(error),
        draftMode,
        reason: setupFailureReason(error),
      });
      rethrowSafeSetupError(error);
    }
  }

  private async prepareCredentials(
    rawInput: ManualConnectionSetupInput,
    setStage: (stage: ManualConnectionSetupOperationStage) => void,
  ): Promise<PreparedManualConnectionCredentials> {
    if (!this.encryptionService) throw new ManualConnectionSetupEncryptionUnavailableError();
    const encryptionService = this.encryptionService;

    setStage("input_validation");
    const input = {
      appId: normalizeMetaAppId(rawInput.appId),
      appSecret: normalizeManualMetaAppSecret(rawInput.appSecret),
      systemUserAccessToken: normalizeManualSystemUserAccessToken(rawInput.systemUserAccessToken),
    };

    setStage("credential_verification");
    let inspection;
    try {
      inspection = await this.metaTransport.inspectSystemUserToken(
        input.appId,
        input.appSecret,
        input.systemUserAccessToken,
      );
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) {
        const issueCode = manualMetaTransportIssueCode(error, "inspect_system_user_token");
        recordWhatsAppConnectionAudit("whatsapp_connection.manual_meta_graph_failed", {
          metaOperation: error.operation ?? "inspect_system_user_token",
          httpStatus: error.httpStatus,
          metaErrorCode: error.metaErrorCode,
          metaErrorSubcode: error.metaErrorSubcode,
          issueCode,
        });
        throw new ManualConnectionValidationError(issueCode);
      }
      throw error;
    }
    if (!inspection.valid) throw new ManualConnectionValidationError("META_TOKEN_INVALID");
    if (inspection.appId !== input.appId) throw new ManualConnectionValidationError("META_APP_CREDENTIAL_MISMATCH");
    if (inspection.expiresAt) {
      const expiresAt = inspection.expiresAt.getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new ManualConnectionValidationError("META_TOKEN_EXPIRED");
      }
    }
    if ((inspection.type ?? "").toUpperCase() !== "SYSTEM_USER" || !inspection.systemUserId) {
      throw new ManualConnectionValidationError("META_TOKEN_TYPE_INVALID");
    }
    if (missingManualSystemUserRequiredScope(inspection.scopes)) {
      throw new ManualConnectionValidationError("META_REQUIRED_PERMISSION_MISSING");
    }

    setStage("verify_token_generation");
    const verifyToken = generateWebhookVerifyToken();
    setStage("app_secret_encryption");
    const encryptedAppSecret = encryptionService.encryptManualMetaAppSecret(input.appSecret);
    setStage("system_user_access_token_encryption");
    const encryptedSystemUserAccessToken = encryptionService.encryptManualSystemUserAccessToken(input.systemUserAccessToken);
    setStage("webhook_verify_token_encryption");
    const encryptedWebhookVerifyToken = encryptionService.encryptManualWebhookVerifyToken(verifyToken);

    return {
      appId: input.appId,
      verifyToken,
      credential: {
        encryptedMetaAppSecret: encryptedAppSecret.encryptedMetaAppSecret,
        metaAppSecretKeyVersion: encryptedAppSecret.metaAppSecretKeyVersion,
        encryptedSystemUserAccessToken: encryptedSystemUserAccessToken.encryptedSystemUserAccessToken,
        systemUserAccessTokenKeyVersion: encryptedSystemUserAccessToken.systemUserAccessTokenKeyVersion,
        encryptedWebhookVerifyToken: encryptedWebhookVerifyToken.encryptedWebhookVerifyToken,
        webhookVerifyTokenKeyVersion: encryptedWebhookVerifyToken.webhookVerifyTokenKeyVersion,
      },
    };
  }
}

export const __phase11kM1ManualSetupTesting = {
  generatePublicWebhookId,
  generateWebhookVerifyToken,
};
