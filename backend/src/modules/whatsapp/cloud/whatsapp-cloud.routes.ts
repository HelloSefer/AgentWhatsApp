import { Router } from "express";
import {
  getWhatsAppCloudDiagnostics,
  getWhatsAppCloudSubscribedApps,
  receiveWhatsAppCloudWebhook,
  simulateWhatsAppCloudIncoming,
  subscribeWhatsAppCloudApp,
  testWhatsAppCloudSendOrderFormCta,
  testWhatsAppCloudSendOrderFlow,
  testWhatsAppCloudSendInteractivePreview,
  testWhatsAppCloudSendReplyButtons,
  testWhatsAppCloudSendText,
  verifyWhatsAppCloudWebhook,
} from "./whatsapp-cloud.controller";

const router = Router();

router.get("/diagnostics", getWhatsAppCloudDiagnostics);
router.get("/subscribed-apps", getWhatsAppCloudSubscribedApps);
router.post("/subscribe-app", subscribeWhatsAppCloudApp);
router.post("/simulate-incoming", simulateWhatsAppCloudIncoming);
router.get("/webhook", verifyWhatsAppCloudWebhook);
router.post("/webhook", receiveWhatsAppCloudWebhook);
router.post("/test-send-text", testWhatsAppCloudSendText);
router.post(
  "/test-send-interactive-preview",
  testWhatsAppCloudSendInteractivePreview,
);
router.post("/test-send-order-flow", testWhatsAppCloudSendOrderFlow);
router.post("/test-send-order-form-cta", testWhatsAppCloudSendOrderFormCta);
router.post("/test-send-reply-buttons", testWhatsAppCloudSendReplyButtons);

export default router;
