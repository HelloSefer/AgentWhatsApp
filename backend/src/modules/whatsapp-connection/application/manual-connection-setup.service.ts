import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseTransactionExecutor, TenantContext } from "../../../infrastructure/database";
import { withTransaction } from "../../../infrastructure/database";
import type { ManualWhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionValidationError,
} from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import { normalizeManualSecret, normalizeMetaAppId } from "../domain/whatsapp-connection.validation";
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

function generateWebhookVerifyToken(): string {
  return randomBytes(32).toString("base64url");
}

function generatePublicWebhookId(): string {
  return randomUUID().replace(/-/gu, "");
}

function safePersistenceError(error: unknown): never {
  if (error instanceof WhatsAppConnectionValidationError) throw error;
  if (error instanceof WhatsAppConnectionCredentialEncryptionError) throw error;
  throw new WhatsAppConnectionPersistenceError(error);
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

export class ManualConnectionSetupService {
  constructor(
    private readonly repository: ManualWhatsAppConnectionRepository,
    private readonly encryptionService: WhatsAppConnectionCredentialEncryptionService | null,
    private readonly transactionRunner: ManualConnectionTransactionRunner = withTransaction,
  ) {}

  async setup(tenant: TenantContext, rawInput: ManualConnectionSetupInput): Promise<ManualConnectionSetupResult> {
    if (!this.encryptionService) throw new WhatsAppConnectionCredentialEncryptionError();
    const input = {
      appId: normalizeMetaAppId(rawInput.appId),
      appSecret: normalizeManualSecret(rawInput.appSecret),
      systemUserAccessToken: normalizeManualSecret(rawInput.systemUserAccessToken),
    };
    const verifyToken = generateWebhookVerifyToken();
    const encryptedAppSecret = this.encryptionService.encryptManualMetaAppSecret(input.appSecret);
    const encryptedSystemUserAccessToken = this.encryptionService.encryptManualSystemUserAccessToken(input.systemUserAccessToken);
    const encryptedWebhookVerifyToken = this.encryptionService.encryptManualWebhookVerifyToken(verifyToken);

    try {
      const connection = await this.transactionRunner(async (executor) => {
        const existing = await this.repository.findReusableManualDraft(tenant, input.appId, { executor });
        const draft = existing ?? await this.repository.createManualDraft(tenant, {
          metaAppId: input.appId,
          publicWebhookId: generatePublicWebhookId(),
        }, { executor });
        const stored = await this.repository.persistManualCredentials(tenant, draft.connectionId, {
          encryptedMetaAppSecret: encryptedAppSecret.encryptedMetaAppSecret,
          metaAppSecretKeyVersion: encryptedAppSecret.metaAppSecretKeyVersion,
          encryptedSystemUserAccessToken: encryptedSystemUserAccessToken.encryptedSystemUserAccessToken,
          systemUserAccessTokenKeyVersion: encryptedSystemUserAccessToken.systemUserAccessTokenKeyVersion,
          encryptedWebhookVerifyToken: encryptedWebhookVerifyToken.encryptedWebhookVerifyToken,
          webhookVerifyTokenKeyVersion: encryptedWebhookVerifyToken.webhookVerifyTokenKeyVersion,
        }, { executor });
        if (!stored) throw new WhatsAppConnectionPersistenceError();
        return draft;
      });

      return setupResponse(connection, verifyToken);
    } catch (error) {
      safePersistenceError(error);
    }
  }
}

export const __phase11kM1ManualSetupTesting = {
  generatePublicWebhookId,
  generateWebhookVerifyToken,
};
