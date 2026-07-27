import { Router } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import { createPersistenceComposition } from "../../composition/persistence/create-persistence-composition";
import type { AuthComposition } from "../../composition/auth/auth-composition.types";
import type { PersistenceComposition } from "../../composition/persistence/persistence-composition.types";
import { requireAuthenticatedPrincipal, requirePermission } from "../auth/http/auth.middleware";
import { rateLimitAuth } from "../auth/http/auth-rate-limit.middleware";
import { OnboardingController } from "./http/onboarding.controller";
import { multipartImage } from "./http/multipart-image.middleware";
import type { Request } from "express";

function resolveLogoSellerTarget(req: Request): unknown {
  return req.query.sellerId;
}

export function createOnboardingRoutes(
  authComposition: AuthComposition = createAuthComposition(),
  persistenceComposition: PersistenceComposition = createPersistenceComposition(),
): Router {
  const router = Router();
  const controller = new OnboardingController(
    authComposition.authRepositories,
    persistenceComposition.sellerWorkspaceProfileRepository,
    persistenceComposition.sellerWorkspaceOnboardingService,
    persistenceComposition.sellerLogoService,
  );
  const authenticate = requireAuthenticatedPrincipal(authComposition.sessionAuthService);
  const requireOwner = requirePermission(authComposition.authorizationService, "seller.manage", resolveLogoSellerTarget);
  const userIdentifier = (req: Request) => (req as Partial<{ auth?: { userId?: string } }>).auth?.userId ?? req.ip;

  router.get("/status", authenticate, controller.status);
  router.post(
    "/workspace",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_workspace_create", userIdentifier),
    controller.createWorkspace,
  );
  router.post(
    "/logo",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_logo_mutation", userIdentifier),
    requireOwner,
    multipartImage(),
    controller.uploadLogo,
  );
  router.delete(
    "/logo",
    authenticate,
    rateLimitAuth(authComposition.authRateLimiter, "onboarding_logo_mutation", userIdentifier),
    requireOwner,
    controller.deleteLogo,
  );

  return router;
}

export default createOnboardingRoutes();
