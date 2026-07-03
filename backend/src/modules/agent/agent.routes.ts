import { Router } from "express";
import {
  deleteAgentAdminNotification,
  getAgentOrder,
  getAgentAdminNotification,
  listAgentOrders,
  listAgentAdminNotifications,
  markAllAgentAdminNotificationsRead,
  markAgentAdminNotificationRead,
  testAgentReply,
  updateAgentOrderStatus,
} from "./agent.controller";

const router = Router();

router.post("/test", testAgentReply);
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
