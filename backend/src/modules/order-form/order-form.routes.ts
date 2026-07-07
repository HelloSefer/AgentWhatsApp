import { Router } from "express";
import {
  renderOrderForm,
  submitOrderForm,
  testOrderFormLink,
} from "./order-form.controller";

const router = Router();

router.get("/order-form", renderOrderForm);
router.post("/api/order-form/submit", submitOrderForm);
router.post("/api/order-form/test-link", testOrderFormLink);

export default router;
