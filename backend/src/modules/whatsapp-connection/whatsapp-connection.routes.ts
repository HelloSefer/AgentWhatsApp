import { Router, type Request } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import type { AuthComposition } from "../../composition/auth/auth-composition.types";
import { requireAuthenticatedPrincipal, requirePermission } from "../auth/http/auth.middleware";
import { rateLimitAuth } from "../auth/http/auth-rate-limit.middleware";
import { getMetaEmbeddedSignupConfiguration } from "./application/meta-embedded-signup.config";
import { EmbeddedSignupCompletionService } from "./application/embedded-signup-completion.service";
import { WhatsAppConnectionCurrentService } from "./application/whatsapp-connection-current.service";
import { WhatsAppConnectionFinalizationService } from "./application/whatsapp-connection-finalization.service";
import { WhatsAppConnectionDisconnectService } from "./application/whatsapp-connection-disconnect.service";
import { ManualConnectionSetupService } from "./application/manual-connection-setup.service";
import { ManualConnectionAssetsService } from "./application/manual-connection-assets.service";
import { ManualConnectionFinalizationService } from "./application/manual-connection-finalization.service";
import { ManualWebhookConfigurationService } from "./application/manual-webhook-configuration.service";
import { WhatsAppConnectionCredentialEncryptionService } from "./application/whatsapp-connection-credential-encryption.service";
import { getWhatsAppConnectionCredentialEncryptionConfiguration } from "./application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCredentialService } from "./application/whatsapp-connection-credential.service";
import { WhatsAppConnectionController } from "./http/whatsapp-connection.controller";
import { FetchMetaEmbeddedSignupTransport } from "./infrastructure/meta/meta-embedded-signup.transport";
import { FetchManualMetaAppTransport } from "./infrastructure/meta/manual-meta-app.transport";
import { postgreSqlWhatsAppConnectionRepository } from "./infrastructure/postgresql/postgresql-whatsapp-connection.repository";
import type { MetaEmbeddedSignupConfiguration } from "./application/meta-embedded-signup.config";
import type { WhatsAppConnectionCredentialService as CredentialService } from "./application/whatsapp-connection-credential.service";

function safeMetaConfiguration(): MetaEmbeddedSignupConfiguration | null {
  try {
    return getMetaEmbeddedSignupConfiguration();
  } catch {
    return null;
  }
}

function safeCredentialService(): CredentialService | null {
  try {
    const encryptionConfiguration = getWhatsAppConnectionCredentialEncryptionConfiguration();
    const encryptionService = new WhatsAppConnectionCredentialEncryptionService(encryptionConfiguration);
    return new WhatsAppConnectionCredentialService(postgreSqlWhatsAppConnectionRepository, encryptionService);
  } catch {
    return null;
  }
}

function safeCredentialEncryptionService(): WhatsAppConnectionCredentialEncryptionService | null {
  try {
    const encryptionConfiguration = getWhatsAppConnectionCredentialEncryptionConfiguration();
    return new WhatsAppConnectionCredentialEncryptionService(encryptionConfiguration);
  } catch {
    return null;
  }
}

export function createWhatsAppConnectionRoutes(
  authComposition: AuthComposition = createAuthComposition(),
): Router {
  const router = Router();
  const authenticate = requireAuthenticatedPrincipal(authComposition.sessionAuthService);
  const authorizeRead = requirePermission(authComposition.authorizationService, "whatsapp_connection.read");
  const authorizeManage = requirePermission(authComposition.authorizationService, "whatsapp_connection.manage");
  const userIdentifier = (req: Request) => (req as Partial<{ auth?: { userId?: string } }>).auth?.userId ?? req.ip;

  const metaConfiguration = safeMetaConfiguration();
  const credentialService = safeCredentialService();
  const manualSetupService = new ManualConnectionSetupService(
    postgreSqlWhatsAppConnectionRepository,
    safeCredentialEncryptionService(),
  );
  const manualAssetsService = new ManualConnectionAssetsService(
    postgreSqlWhatsAppConnectionRepository,
    safeCredentialEncryptionService(),
    new FetchManualMetaAppTransport(metaConfiguration?.graphApiVersion ?? "v25.0"),
  );
  const manualWebhookConfigurationService = new ManualWebhookConfigurationService(
    postgreSqlWhatsAppConnectionRepository,
    safeCredentialEncryptionService(),
    new FetchManualMetaAppTransport(metaConfiguration?.graphApiVersion ?? "v25.0"),
  );
  const manualFinalizationService = new ManualConnectionFinalizationService(
    postgreSqlWhatsAppConnectionRepository,
    safeCredentialEncryptionService(),
    new FetchManualMetaAppTransport(metaConfiguration?.graphApiVersion ?? "v25.0"),
  );
  const metaTransport = metaConfiguration
    ? new FetchMetaEmbeddedSignupTransport(metaConfiguration)
    : {
        exchangeCode: async () => { throw new Error("Meta configuration unavailable."); },
        inspectToken: async () => { throw new Error("Meta configuration unavailable."); },
        readWaba: async () => { throw new Error("Meta configuration unavailable."); },
        readPhoneNumber: async () => { throw new Error("Meta configuration unavailable."); },
        registerPhoneNumber: async () => { throw new Error("Meta configuration unavailable."); },
        readPhoneNumberRegistrationStatus: async () => { throw new Error("Meta configuration unavailable."); },
        subscribeWabaToWebhooks: async () => { throw new Error("Meta configuration unavailable."); },
        readWabaWebhookSubscriptionStatus: async () => { throw new Error("Meta configuration unavailable."); },
      };
  const completionService = new EmbeddedSignupCompletionService(
    postgreSqlWhatsAppConnectionRepository,
    credentialService,
    metaTransport,
    metaConfiguration,
  );
  const finalizationService = new WhatsAppConnectionFinalizationService(
    postgreSqlWhatsAppConnectionRepository,
    credentialService,
    metaTransport,
  );
  const currentService = new WhatsAppConnectionCurrentService(postgreSqlWhatsAppConnectionRepository);
  const disconnectService = new WhatsAppConnectionDisconnectService(postgreSqlWhatsAppConnectionRepository);
  const controller = new WhatsAppConnectionController(completionService, currentService, finalizationService, disconnectService, manualSetupService, manualAssetsService, manualWebhookConfigurationService, manualFinalizationService);

  router.get(
    "/current",
    authenticate,
    authorizeRead,
    controller.getCurrentConnection,
  );

  router.post(
    "/manual/setup",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorizeManage,
    controller.setupManualConnection,
  );

  router.post(
    "/manual/:connectionId/discover",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorizeManage,
    controller.discoverManualAssets,
  );

  router.post(
    "/manual/:connectionId/select-assets",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorizeManage,
    controller.selectManualAssets,
  );

  router.post(
    "/manual/:connectionId/configure-webhook",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorizeManage,
    controller.configureManualWebhook,
  );

  router.post(
    "/manual/:connectionId/finalize",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorizeManage,
    controller.finalizeManualConnection,
  );

  router.post(
    "/embedded-signup/complete",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorizeManage,
    controller.completeEmbeddedSignup,
  );

  router.post(
    "/:connectionId/finalize",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorizeManage,
    controller.finalizeConnection,
  );

  router.post(
    "/:connectionId/disconnect",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorizeManage,
    controller.disconnectConnection,
  );

  return router;
}

export default createWhatsAppConnectionRoutes();
