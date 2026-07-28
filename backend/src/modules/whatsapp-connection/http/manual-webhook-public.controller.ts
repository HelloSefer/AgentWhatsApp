import type { Request, Response } from "express";
import { ManualWebhookConfigurationError, WhatsAppConnectionCredentialEncryptionError } from "../domain/whatsapp-connection.errors";
import type { ManualWhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import type { WhatsAppConnectionCredentialEncryptionService } from "../application/whatsapp-connection-credential-encryption.service";
import { timingSafeStringEqual, verifyMetaSignature } from "../application/manual-webhook-security.service";
import { assertManualWebhookPayloadOwnership, parseSignedWebhookBody } from "../application/manual-webhook-payload.service";
import { processVerifiedWhatsAppCloudWebhook } from "../../whatsapp/cloud/whatsapp-cloud.controller";
import { recordWhatsAppConnectionAudit, incrementWhatsAppConnectionMetric } from "../application/whatsapp-connection-operational-events";
import { createTenantContext } from "../../../infrastructure/database";

function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeFailure(res: Response): Response {
  return res.status(403).json({ message: "Webhook verification failed." });
}

export class ManualWebhookPublicController {
  constructor(
    private readonly repository: ManualWhatsAppConnectionRepository,
    private readonly encryptionService: WhatsAppConnectionCredentialEncryptionService | null,
  ) {}

  verify = async (req: Request, res: Response): Promise<Response> => {
    try {
      const mode = queryString(req.query["hub.mode"]);
      const verifyToken = queryString(req.query["hub.verify_token"]);
      const challenge = queryString(req.query["hub.challenge"]);
      if (mode !== "subscribe" || !verifyToken || !challenge) throw new ManualWebhookConfigurationError("WEBHOOK_VERIFICATION_FAILED");
      if (!this.encryptionService) throw new WhatsAppConnectionCredentialEncryptionError();
      const connection = await this.repository.findByPublicWebhookId(String(req.params.publicWebhookId ?? ""));
      if (!connection || connection.connectionMethod !== "CUSTOMER_OWNED_META_APP" || (connection.status !== "VERIFYING" && connection.status !== "ACTIVE" && connection.status !== "REPLACEMENT_PENDING")) {
        throw new ManualWebhookConfigurationError("WEBHOOK_VERIFICATION_FAILED");
      }
      const storage = await this.repository.findManualCredentialStorage(createTenantContext(connection.sellerId), connection.connectionId);
      if (!storage) throw new ManualWebhookConfigurationError("WEBHOOK_VERIFICATION_FAILED");
      const expected = this.encryptionService.decryptManualWebhookVerifyToken(storage.encryptedWebhookVerifyToken);
      if (!timingSafeStringEqual(verifyToken, expected)) throw new ManualWebhookConfigurationError("WEBHOOK_VERIFICATION_FAILED");
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_webhook_verification_succeeded", { connectionId: connection.connectionId });
      return res.status(200).type("text/plain").send(challenge);
    } catch {
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_webhook_verification_failed", { reason: "verification_failed" });
      incrementWhatsAppConnectionMetric("whatsapp_connection_failures_total", { reason: "verification_failed" });
      return safeFailure(res);
    }
  };

  receive = async (req: Request, res: Response): Promise<Response | void> => {
    let connectionId: string | undefined;
    try {
      if (!this.encryptionService) throw new WhatsAppConnectionCredentialEncryptionError();
      const connection = await this.repository.findByPublicWebhookId(String(req.params.publicWebhookId ?? ""));
      if (!connection || connection.connectionMethod !== "CUSTOMER_OWNED_META_APP" || !connection.wabaId || !connection.phoneNumberId || (connection.status !== "VERIFYING" && connection.status !== "ACTIVE" && connection.status !== "REPLACEMENT_PENDING")) {
        throw new ManualWebhookConfigurationError("WEBHOOK_CONNECTION_MISMATCH");
      }
      connectionId = connection.connectionId;
      const tenant = createTenantContext(connection.sellerId);
      const storage = await this.repository.findManualCredentialStorage(tenant, connection.connectionId);
      if (!storage) throw new ManualWebhookConfigurationError("WEBHOOK_SIGNATURE_INVALID");
      const appSecret = this.encryptionService.decryptManualMetaAppSecret(storage.encryptedMetaAppSecret);
      const rawBody = Buffer.isBuffer(req.body) ? req.body : (req as typeof req & { rawBody?: Buffer }).rawBody;
      const signature = typeof req.header("x-hub-signature-256") === "string" ? req.header("x-hub-signature-256") : undefined;
      if (!verifyMetaSignature(rawBody, appSecret, signature)) throw new ManualWebhookConfigurationError("WEBHOOK_SIGNATURE_INVALID");
      const parsed = parseSignedWebhookBody(rawBody);
      assertManualWebhookPayloadOwnership(connection, parsed);
      return processVerifiedWhatsAppCloudWebhook(req, res, parsed);
    } catch (error) {
      if (error instanceof ManualWebhookConfigurationError && error.issueCode === "WEBHOOK_SIGNATURE_INVALID") {
        recordWhatsAppConnectionAudit("whatsapp_connection.manual_webhook_signature_failed", { ...(connectionId ? { connectionId } : {}), reason: "verification_failed" });
        return res.status(403).json({ message: "Invalid webhook signature." });
      }
      recordWhatsAppConnectionAudit("whatsapp_connection.manual_webhook_payload_mismatch", { ...(connectionId ? { connectionId } : {}), reason: "verification_failed" });
      return res.status(400).json({ message: "Invalid webhook payload." });
    }
  };
}

