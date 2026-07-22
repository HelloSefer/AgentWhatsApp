import type { Request, Response } from "express";
import {
  getEffectiveConversationConfiguration,
  previewConversationConfiguration,
  validateConversationConfigurationPayload,
} from "./preview/conversation-config-preview.service";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function validateConversationConfigController(req: Request, res: Response) {
  const payload = req.body?.config ?? req.body;
  return res.status(200).json(validateConversationConfigurationPayload(payload));
}

export function previewConversationConfigController(req: Request, res: Response) {
  const sellerId = text(req.body?.sellerId) || "seller_demo_sandals";
  try {
    return res.status(200).json(previewConversationConfiguration({
      sellerId,
      productId: text(req.body?.productId),
      sellerOverride: req.body?.sellerOverride,
      productOverride: req.body?.productOverride ?? req.body?.config,
      messageKey: req.body?.messageKey,
      variables: req.body?.variables,
      optionKey: req.body?.optionKey,
      currentValueKey: req.body?.currentValueKey,
      listKey: req.body?.listKey,
    }));
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : "Conversation configuration preview failed",
    });
  }
}

export function getEffectiveConversationConfigController(req: Request, res: Response) {
  const sellerId = text(req.params.sellerId);
  if (!sellerId) return res.status(400).json({ message: "sellerId is required" });
  try {
    return res.status(200).json(getEffectiveConversationConfiguration({
      sellerId,
      productId: text(req.query.productId),
    }));
  } catch (error) {
    return res.status(404).json({
      message: error instanceof Error ? error.message : "Conversation configuration not found",
    });
  }
}
