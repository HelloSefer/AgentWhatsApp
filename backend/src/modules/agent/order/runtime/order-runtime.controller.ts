import type { Request, Response } from "express";
import { conversationKeyService } from "../../identity/conversation-key.service";
import { evaluateGuardedOrderRuntime } from "./order-runtime-eval.service";
import { clearOrderRuntimeSession } from "./order-runtime-session.service";
import { getOrderRuntimeReadiness } from "./order-runtime-router.service";

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
  const productId = optionalText(req.body?.productId) || "prod_demo_sandal_001";
  if (!sellerId || !customerPhone) {
    return res.status(400).json({ message: "sellerId and customerPhone are required" });
  }
  const conversationKey = conversationKeyService.buildConversationKey(sellerId, customerPhone);
  await clearOrderRuntimeSession({ sellerId, customerPhone, conversationKey, productId });
  return res.status(200).json({ ok: true, sellerId, customerPhone, conversationKey });
}

export async function evaluateOrderRuntimeController(_req: Request, res: Response) {
  const report = await evaluateGuardedOrderRuntime();
  return res.status(report.strictAcceptance ? 200 : 500).json(report);
}
