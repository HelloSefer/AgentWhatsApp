import type { Request, Response } from "express";
import { env } from "../../../../config/env";
import { productContextService } from "../../config/product-context.service";
import { conversationKeyService } from "../../identity/conversation-key.service";
import { evaluateGuardedOrderRuntime } from "./order-runtime-eval.service";
import { evaluateOrderRuntimeWebhookIntegration } from "./order-runtime-webhook-eval.service";
import { evaluateOrderRuntimeFinalReviewReceipt } from "./order-runtime-final-review-receipt-eval.service";
import {
  clearOrderRuntimeSession,
  resetOrderRuntimeConversation,
} from "./order-runtime-session.service";
import { getOrderRuntimeReadiness } from "./order-runtime-router.service";

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePhone(value: string | undefined): string {
  return (value || "").replace(/\D/g, "");
}

function isAllowedFullResetScope(sellerId: string, customerPhone: string): boolean {
  return (
    sellerId === env.firstEntryLiveSmokeSellerId.trim() &&
    normalizePhone(customerPhone) ===
      normalizePhone(env.firstEntryLiveSmokeTestRecipient)
  );
}

export async function getOrderRuntimeReadinessController(req: Request, res: Response) {
  const sellerId = optionalText(req.query.sellerId) || "seller_demo_sandals";
  return res.status(200).json(await getOrderRuntimeReadiness(
    sellerId,
    req.query.runtimeEnabled === "true",
  ));
}

export async function resetOrderRuntimeController(req: Request, res: Response) {
  const sellerId = optionalText(req.body?.sellerId);
  const customerPhone = optionalText(req.body?.customerPhone);
  if (!sellerId || !customerPhone) {
    return res.status(400).json({ message: "sellerId and customerPhone are required" });
  }
  const productId =
    optionalText(req.body?.productId) ||
    productContextService.getActiveProductContext(sellerId).productId;
  const conversationKey = conversationKeyService.buildConversationKey(sellerId, customerPhone);
  if (req.body?.fullFlowReset === true) {
    if (!isAllowedFullResetScope(sellerId, customerPhone)) {
      return res.status(403).json({
        ok: false,
        message: "Full flow reset is restricted to the configured smoke-test scope",
      });
    }
    const deleted = await resetOrderRuntimeConversation({
      sellerId,
      customerPhone,
      conversationKey,
      productId,
    });
    return res.status(200).json({
      ok: true,
      deleted,
      fullFlowReset: true,
      sellerId,
      customerPhone,
      conversationKey,
    });
  }
  await clearOrderRuntimeSession({ sellerId, customerPhone, conversationKey, productId });
  return res.status(200).json({ ok: true, sellerId, customerPhone, conversationKey });
}

export async function evaluateOrderRuntimeController(_req: Request, res: Response) {
  const report = await evaluateGuardedOrderRuntime();
  return res.status(report.strictAcceptance ? 200 : 500).json(report);
}

export async function evaluateOrderRuntimeWebhookController(_req: Request, res: Response) {
  const report = await evaluateOrderRuntimeWebhookIntegration();
  return res.status(report.strictAcceptance ? 200 : 500).json(report);
}

export async function evaluateOrderRuntimeFinalReviewReceiptController(_req: Request, res: Response) {
  const report = await evaluateOrderRuntimeFinalReviewReceipt();
  return res.status(report.strictAcceptance ? 200 : 500).json(report);
}
