import { Router } from "express";
import { getWhatsAppConnectionCredentialEncryptionConfiguration } from "./application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCredentialEncryptionService } from "./application/whatsapp-connection-credential-encryption.service";
import { ManualWebhookPublicController } from "./http/manual-webhook-public.controller";
import { postgreSqlWhatsAppConnectionRepository } from "./infrastructure/postgresql/postgresql-whatsapp-connection.repository";

function safeCredentialEncryptionService(): WhatsAppConnectionCredentialEncryptionService | null {
  try {
    return new WhatsAppConnectionCredentialEncryptionService(getWhatsAppConnectionCredentialEncryptionConfiguration());
  } catch {
    return null;
  }
}

export function createManualWebhookPublicRoutes(): Router {
  const router = Router();
  const controller = new ManualWebhookPublicController(postgreSqlWhatsAppConnectionRepository, safeCredentialEncryptionService());
  router.get("/:publicWebhookId", controller.verify);
  router.post("/:publicWebhookId", controller.receive);
  return router;
}

export default createManualWebhookPublicRoutes();
