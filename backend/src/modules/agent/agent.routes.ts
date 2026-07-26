import { Router } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import { requireAuthenticatedPrincipal, requirePermission } from "../auth/http/auth.middleware";
import { SELLER_ROUTE_PERMISSIONS } from "../auth/http/seller-route-permissions";
import { resolveRequestedSellerTarget } from "../auth/http/seller-target.resolver";
import {
  deleteAgentAdminNotification,
  benchmarkAgentNaturalReply,
  evalAgentIntents,
  evalAgentNaturalReplies,
  evalAgentReplies,
  evalAgentSellerBrain,
  evalAgentConversationScenarios,
  evalAgentContextualOrderUnderstanding,
  evalAgentInformationalAI,
  firstEntryClickPreview,
  firstEntryDryRun,
  firstEntryLiveSmokeDispatchPreview,
  getFirstEntryLiveSmokeReadiness,
  getFirstEntryReadiness,
  getAgentNaturalReplyStatus,
  getAgentOrder,
  getAgentAdminNotification,
  listAgentOrders,
  listAgentAdminNotifications,
  markAllAgentAdminNotificationsRead,
  markAgentAdminNotificationRead,
  resetAgentNaturalReplyState,
  smokeAgentNaturalReply,
  testAgentIntent,
  testAgentReply,
  updateAgentOrderStatus,
} from "./agent.controller";
import {
  getAgentConfig,
  getAgentFirstEntryEligibilityPreview,
  getAgentFirstEntryPreview,
  getAgentRequiredFields,
  postAgentFirstEntryIntentPreview,
} from "./config/agent-config.controller";
import {
  evaluateOrderRuntimeController,
  evaluateOrderRuntimeFinalReviewReceiptController,
  evaluateTotalPiecePlanningController,
  evaluateGroupedDeliveryIntakeController,
  evaluateDirectProductEditingController,
  evaluateMoreInfoOrderContinuationController,
  evaluateOrderRuntimeWebhookController,
  getOrderRuntimeReadinessController,
  resetOrderRuntimeController,
} from "./order/runtime/order-runtime.controller";

const router = Router();
const authComposition = createAuthComposition();
const authenticate = requireAuthenticatedPrincipal(authComposition.sessionAuthService);
const requireSellerPermission = (permission: Parameters<typeof requirePermission>[1]) =>
  requirePermission(authComposition.authorizationService, permission, resolveRequestedSellerTarget);

router.post("/test", testAgentReply);
router.get("/order-runtime/readiness", getOrderRuntimeReadinessController);
router.post("/order-runtime/reset", resetOrderRuntimeController);
router.post("/order-runtime/eval", evaluateOrderRuntimeController);
router.post("/order-runtime/webhook-eval", evaluateOrderRuntimeWebhookController);
router.post("/order-runtime/final-review-receipt-eval", evaluateOrderRuntimeFinalReviewReceiptController);
router.post("/order-runtime/total-piece-planning-eval", evaluateTotalPiecePlanningController);
router.post("/order-runtime/grouped-delivery-eval", evaluateGroupedDeliveryIntakeController);
router.post("/order-runtime/direct-product-edit-eval", evaluateDirectProductEditingController);
router.post("/order-runtime/more-info-continuation-eval", evaluateMoreInfoOrderContinuationController);
router.post("/first-entry-dry-run", firstEntryDryRun);
router.post("/first-entry-click-preview", firstEntryClickPreview);
router.get("/first-entry-readiness", getFirstEntryReadiness);
router.get("/first-entry-live-smoke-readiness", getFirstEntryLiveSmokeReadiness);
router.post(
  "/first-entry-live-smoke-dispatch-preview",
  firstEntryLiveSmokeDispatchPreview,
);
router.post("/intent-test", testAgentIntent);
router.post("/eval-intents", evalAgentIntents);
router.post("/eval-replies", evalAgentReplies);
router.post("/eval-natural-replies", evalAgentNaturalReplies);
router.post("/eval-seller-brain", evalAgentSellerBrain);
router.post("/eval-conversation-scenarios", evalAgentConversationScenarios);
router.post("/eval-contextual-order-understanding", evalAgentContextualOrderUnderstanding);
router.post("/eval-informational-ai", evalAgentInformationalAI);
router.get(
  "/config/:sellerId/first-entry-eligibility-preview",
  authenticate,
  requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentConfigPreviewRead),
  getAgentFirstEntryEligibilityPreview,
);
router.post(
  "/config/:sellerId/first-entry-intent-preview",
  authenticate,
  requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentConfigPreviewRead),
  postAgentFirstEntryIntentPreview,
);
router.get("/config/:sellerId/first-entry-preview", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentConfigPreviewRead), getAgentFirstEntryPreview);
router.get("/config/:sellerId/required-fields", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentConfigRead), getAgentRequiredFields);
router.get("/config/:sellerId", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentConfigRead), getAgentConfig);
router.get("/natural-reply/status", getAgentNaturalReplyStatus);
router.post("/natural-reply/reset", resetAgentNaturalReplyState);
router.post("/natural-reply/smoke", smokeAgentNaturalReply);
router.post("/natural-reply/benchmark", benchmarkAgentNaturalReply);
router.get("/admin/notifications", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentAdminNotificationsRead), listAgentAdminNotifications);
router.patch(
  "/admin/notifications/read-all",
  authenticate,
  requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentAdminNotificationsManage),
  markAllAgentAdminNotificationsRead,
);
router.get("/admin/notifications/:id", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentAdminNotificationsRead), getAgentAdminNotification);
router.patch(
  "/admin/notifications/:id/read",
  authenticate,
  requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentAdminNotificationsManage),
  markAgentAdminNotificationRead,
);
router.delete("/admin/notifications/:id", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentAdminNotificationsManage), deleteAgentAdminNotification);
router.get("/orders", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentOrdersRead), listAgentOrders);
router.get("/orders/:id", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentOrdersRead), getAgentOrder);
router.patch("/orders/:id/status", authenticate, requireSellerPermission(SELLER_ROUTE_PERMISSIONS.agentOrdersManage), updateAgentOrderStatus);

export default router;
