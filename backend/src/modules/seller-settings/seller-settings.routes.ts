import { Router } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import { createPersistenceComposition } from "../../composition/persistence/create-persistence-composition";
import type { AuthComposition } from "../../composition/auth/auth-composition.types";
import type { PersistenceComposition } from "../../composition/persistence/persistence-composition.types";
import { requireAuthenticatedPrincipal, requirePermission } from "../auth/http/auth.middleware";
import { SellerSettingsService } from "./application/seller-settings.service";
import { SellerSettingsController } from "./http/seller-settings.controller";

export function createSellerSettingsRoutes(
  authComposition: AuthComposition = createAuthComposition(),
  persistenceComposition: PersistenceComposition = createPersistenceComposition(),
): Router {
  const router = Router();
  const authenticate = requireAuthenticatedPrincipal(authComposition.sessionAuthService);
  const authorizeTenant = requirePermission(authComposition.authorizationService, "seller.read");
  const service = new SellerSettingsService(persistenceComposition.sellerWorkspaceProfileRepository);
  const controller = new SellerSettingsController(service);

  router.get("/settings", authenticate, authorizeTenant, controller.read);
  router.put("/settings", authenticate, authorizeTenant, controller.update);

  return router;
}

export default createSellerSettingsRoutes();
