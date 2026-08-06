import { Router } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import { createPersistenceComposition } from "../../composition/persistence/create-persistence-composition";
import type { AuthComposition } from "../../composition/auth/auth-composition.types";
import type { PersistenceComposition } from "../../composition/persistence/persistence-composition.types";
import { requireAuthenticatedPrincipal, requirePermission } from "../auth/http/auth.middleware";
import { CatalogProductController } from "./http/catalog-product.controller";

export function createCatalogProductRoutes(authComposition: AuthComposition = createAuthComposition(), persistenceComposition: PersistenceComposition = createPersistenceComposition()): Router {
  const router = Router();
  const authenticate = requireAuthenticatedPrincipal(authComposition.sessionAuthService);
  const read = requirePermission(authComposition.authorizationService, "catalog.read");
  const manage = requirePermission(authComposition.authorizationService, "catalog.manage");
  const controller = new CatalogProductController(persistenceComposition.catalogService);
  router.get("/products", authenticate, read, controller.list);
  router.get("/products/:productId", authenticate, read, controller.read);
  router.post("/products", authenticate, manage, controller.create);
  router.put("/products/:productId", authenticate, manage, controller.replace);
  router.patch("/products/:productId/availability", authenticate, manage, controller.availability);
  return router;
}
