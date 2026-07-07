import { Router } from "express";
import {
  downloadOrderReceipt,
  testGenerateOrderReceipt,
  testSendOrderReceipt,
} from "./order-receipt.controller";

const router = Router();

router.post("/api/order-receipts/test-generate", testGenerateOrderReceipt);
router.post("/api/order-receipts/test-send", testSendOrderReceipt);
router.get("/api/order-receipts/:orderId.pdf", downloadOrderReceipt);

export default router;

