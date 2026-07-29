import type { TenantContext } from "../../../infrastructure/database";
import type { ManualWhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import { ManualWebhookConfigurationError, WhatsAppConnectionCredentialEncryptionError, WhatsAppConnectionMetaTransportError, WhatsAppConnectionPersistenceError } from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import { normalizeConnectionId } from "../domain/whatsapp-connection.validation";
import type { ManualMetaWebhookTransport } from "../infrastructure/meta/manual-meta-app.transport";
import type { WhatsAppConnectionCredentialEncryptionService } from "./whatsapp-connection-credential-encryption.service";
import { recordWhatsAppConnectionAudit, incrementWhatsAppConnectionMetric } from "./whatsapp-connection-operational-events";
import { buildManualWebhookCallbackUrl } from "./manual-webhook-url.service";

export type ManualWebhookConfigurationResult = Readonly<{
  connection: Readonly<{
    connectionId: string;
    status: "VERIFYING";
    connectionMethod: "CUSTOMER_OWNED_META_APP";
  }>;
  webhook: Readonly<{
    configured: true;
    verified: true;
    subscriptionConfirmed: true;
  }>;
  nextStep: "FINALIZE_CONNECTION";
}>;

function classifyMeta(error: unknown): never {
  if (error instanceof ManualWebhookConfigurationError) throw error;
  if (error instanceof WhatsAppConnectionMetaTransportError) {
    if (error.code === "auth") throw new ManualWebhookConfigurationError("META_PERMISSION_MISSING");
    if (error.code === "unavailable") throw new ManualWebhookConfigurationError("META_TRANSIENT_FAILURE");
    throw new ManualWebhookConfigurationError("WEBHOOK_SUBSCRIPTION_FAILED");
  }
  if (error instanceof WhatsAppConnectionCredentialEncryptionError) throw new ManualWebhookConfigurationError("WEBHOOK_VERIFICATION_FAILED");
  throw new WhatsAppConnectionPersistenceError(error);
}

function assertConfigurable(connection: WhatsAppConnection | null): WhatsAppConnection {
  if (!connection || connection.connectionMethod !== "CUSTOMER_OWNED_META_APP" || connection.status !== "VERIFYING") {
    throw new ManualWebhookConfigurationError("WEBHOOK_CONNECTION_MISMATCH");
  }
  if (!connection.metaAppId || !connection.publicWebhookId || !connection.wabaId || !connection.phoneNumberId) {
    throw new ManualWebhookConfigurationError("WEBHOOK_CONNECTION_MISMATCH");
  }
  return connection;
}

export class ManualWebhookConfigurationService {
  constructor(
    private readonly repository: ManualWhatsAppConnectionRepository,
    private readonly encryptionService: WhatsAppConnectionCredentialEncryptionService | null,
    private readonly metaTransport: ManualMetaWebhookTransport,
    private readonly publicBaseUrl?: string,
  ) {}

  async configure(tenant: TenantContext, connectionId: string): Promise<ManualWebhookConfigurationResult> {
    const connection = assertConfigurable(await this.repository.findByConnectionId(tenant, normalizeConnectionId(connectionId)));
    recordWhatsAppConnectionAudit("whatsapp_connection.manual_webhook_configuration_started", { sellerId: tenant.sellerId, connectionId: connection.connectionId });
    try {
      if (!this.encryptionService) throw new WhatsAppConnectionCredentialEncryptionError();
      const storage = await this.repository.findManualCredentialStorage(tenant, connection.connectionId);
      if (!storage) throw new ManualWebhookConfigurationError("WEBHOOK_VERIFICATION_FAILED");
      const systemUserToken = this.encryptionService.decryptManualSystemUserAccessToken(storage.encryptedSystemUserAccessToken);
      const verifyToken = this.encryptionService.decryptManualWebhookVerifyToken(storage.encryptedWebhookVerifyToken);
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_token_source_resolved", {
        connectionId: connection.connectionId,
        tokenSource: "encrypted_connection_token",
      });
      const callbackUrl = buildManualWebhookCallbackUrl(connection.publicWebhookId!, this.publicBaseUrl);

      const confirmedBefore = await this.confirmSubscription(connection, callbackUrl, systemUserToken);
      if (!confirmedBefore) {
        try {
          await this.metaTransport.subscribeWabaWithCallback(connection.wabaId!, callbackUrl, verifyToken, systemUserToken);
        } catch (error) {
          if (!(error instanceof WhatsAppConnectionMetaTransportError) || error.code !== "unavailable") throw error;
          const confirmedAfterAmbiguousTimeout = await this.confirmSubscription(connection, callbackUrl, systemUserToken);
          if (!confirmedAfterAmbiguousTimeout) throw error;
        }
      }
      const confirmed = await this.confirmSubscription(connection, callbackUrl, systemUserToken);
      if (!confirmed) throw new ManualWebhookConfigurationError("WEBHOOK_SUBSCRIPTION_UNCONFIRMED");
      const marked = await this.repository.persistFinalizationProgress(tenant, connection.connectionId, {
        wabaSubscriptionCompletedAt: new Date(),
        clearFinalizationLastError: true,
      });
      if (!marked) throw new WhatsAppConnectionPersistenceError();
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_webhook_subscription_confirmed", { sellerId: tenant.sellerId, connectionId: connection.connectionId });
      return {
        connection: {
          connectionId: connection.connectionId,
          status: "VERIFYING",
          connectionMethod: "CUSTOMER_OWNED_META_APP",
        },
        webhook: { configured: true, verified: true, subscriptionConfirmed: true },
        nextStep: "FINALIZE_CONNECTION",
      };
    } catch (error) {
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_webhook_subscription_failed", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "verification_failed" });
      incrementWhatsAppConnectionMetric("whatsapp_connection_failures_total", { sellerId: tenant.sellerId, connectionId: connection.connectionId, reason: "verification_failed" });
      classifyMeta(error);
    }
  }

  private async confirmSubscription(connection: WhatsAppConnection, callbackUrl: string, systemUserToken: string): Promise<boolean> {
    const subscriptions = await this.metaTransport.listWabaSubscriptions(connection.wabaId!, systemUserToken);
    return subscriptions.some((subscription) =>
      subscription.appId === connection.metaAppId &&
      subscription.callbackUrl === callbackUrl
    );
  }
}
