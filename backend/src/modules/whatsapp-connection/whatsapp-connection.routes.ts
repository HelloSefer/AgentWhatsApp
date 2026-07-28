import { Router, type Request } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import type { AuthComposition } from "../../composition/auth/auth-composition.types";
import { requireAuthenticatedPrincipal, requirePermission } from "../auth/http/auth.middleware";
import { rateLimitAuth } from "../auth/http/auth-rate-limit.middleware";
import { getMetaEmbeddedSignupConfiguration } from "./application/meta-embedded-signup.config";
import { EmbeddedSignupCompletionService } from "./application/embedded-signup-completion.service";
import { WhatsAppConnectionCredentialEncryptionService } from "./application/whatsapp-connection-credential-encryption.service";
import { getWhatsAppConnectionCredentialEncryptionConfiguration } from "./application/whatsapp-connection-credential-encryption.config";
import { WhatsAppConnectionCredentialService } from "./application/whatsapp-connection-credential.service";
import { WhatsAppConnectionController } from "./http/whatsapp-connection.controller";
import { FetchMetaEmbeddedSignupTransport } from "./infrastructure/meta/meta-embedded-signup.transport";
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

export function createWhatsAppConnectionRoutes(
  authComposition: AuthComposition = createAuthComposition(),
): Router {
  const router = Router();
  const authenticate = requireAuthenticatedPrincipal(authComposition.sessionAuthService);
  const authorize = requirePermission(authComposition.authorizationService, "seller.manage");
  const userIdentifier = (req: Request) => (req as Partial<{ auth?: { userId?: string } }>).auth?.userId ?? req.ip;

  const metaConfiguration = safeMetaConfiguration();
  const credentialService = safeCredentialService();
  const metaTransport = metaConfiguration
    ? new FetchMetaEmbeddedSignupTransport(metaConfiguration)
    : {
        exchangeCode: async () => { throw new Error("Meta configuration unavailable."); },
        inspectToken: async () => { throw new Error("Meta configuration unavailable."); },
        readWaba: async () => { throw new Error("Meta configuration unavailable."); },
        readPhoneNumber: async () => { throw new Error("Meta configuration unavailable."); },
      };
  const completionService = new EmbeddedSignupCompletionService(
    postgreSqlWhatsAppConnectionRepository,
    credentialService,
    metaTransport,
    metaConfiguration,
  );
  const controller = new WhatsAppConnectionController(completionService);

  router.post(
    "/embedded-signup/complete",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    authorize,
    controller.completeEmbeddedSignup,
  );

  return router;
}

export default createWhatsAppConnectionRoutes();
