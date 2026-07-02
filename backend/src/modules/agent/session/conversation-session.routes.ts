import { Router } from "express";
import {
  appendMessage,
  clearSession,
  getSession,
  updateOrderState,
} from "./conversation-session.controller";

const router = Router();

router.get("/:customerId", getSession);
router.post("/:customerId/message", appendMessage);
router.patch("/:customerId/order", updateOrderState);
router.delete("/:customerId", clearSession);

export default router;
