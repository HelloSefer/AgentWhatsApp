import { Router } from "express";
import {
  deleteAgentAdminNotification,
  benchmarkAgentNaturalReply,
  evalAgentIntents,
  evalAgentNaturalReplies,
  evalAgentReplies,
  evalAgentSellerBrain,
  evalAgentConversationScenarios,
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
  getAgentRequiredFields,
} from "./config/agent-config.controller";

const router = Router();

router.post("/test", testAgentReply);
router.post("/intent-test", testAgentIntent);
router.post("/eval-intents", evalAgentIntents);
router.post("/eval-replies", evalAgentReplies);
router.post("/eval-natural-replies", evalAgentNaturalReplies);
router.post("/eval-seller-brain", evalAgentSellerBrain);
router.post("/eval-conversation-scenarios", evalAgentConversationScenarios);
router.get("/config/:sellerId/required-fields", getAgentRequiredFields);
router.get("/config/:sellerId", getAgentConfig);
router.get("/natural-reply/status", getAgentNaturalReplyStatus);
router.post("/natural-reply/reset", resetAgentNaturalReplyState);
router.post("/natural-reply/smoke", smokeAgentNaturalReply);
router.post("/natural-reply/benchmark", benchmarkAgentNaturalReply);
router.get("/admin/notifications", listAgentAdminNotifications);
router.patch(
  "/admin/notifications/read-all",
  markAllAgentAdminNotificationsRead,
);
router.get("/admin/notifications/:id", getAgentAdminNotification);
router.patch(
  "/admin/notifications/:id/read",
  markAgentAdminNotificationRead,
);
router.delete("/admin/notifications/:id", deleteAgentAdminNotification);
router.get("/orders", listAgentOrders);
router.get("/orders/:id", getAgentOrder);
router.patch("/orders/:id/status", updateAgentOrderStatus);

export default router;
