import { Router } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import { requireAuthenticatedPrincipal, requirePermission } from "../auth/http/auth.middleware";
import { SELLER_ROUTE_PERMISSIONS } from "../auth/http/seller-route-permissions";
import { resolveRequestedSellerTarget } from "../auth/http/seller-target.resolver";
import {
  getEffectiveConversationConfigController,
  previewConversationConfigController,
  validateConversationConfigController,
} from "./conversation-config.controller";

const router = Router();
const authComposition = createAuthComposition();
const authenticate = requireAuthenticatedPrincipal(authComposition.sessionAuthService);
const requireConversationConfigRead = requirePermission(
  authComposition.authorizationService,
  SELLER_ROUTE_PERMISSIONS.conversationConfigEffectiveRead,
  resolveRequestedSellerTarget,
);

router.post("/validate", validateConversationConfigController);
router.post("/preview", previewConversationConfigController);
router.get("/effective/:sellerId", authenticate, requireConversationConfigRead, getEffectiveConversationConfigController);

export default router;
