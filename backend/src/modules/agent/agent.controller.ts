import type { Request, Response } from "express";
import { generateAgentResult } from "./agent.service";
import type { ProductContext } from "./product-context.types";

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function testAgentReply(req: Request, res: Response) {
  const message = typeof req.body?.message === "string" ? req.body.message : "";

  if (!message.trim()) {
    return res.status(400).json({
      message: "Message is required",
    });
  }

  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const result = await generateAgentResult(message, productContext, {
      customerId: getOptionalString(req.body?.customerId),
      sellerId: getOptionalString(req.body?.sellerId),
      productId: getOptionalString(req.body?.productId),
      useMemory: req.body?.useMemory === true,
    });

    return res.status(200).json({
      reply: result.reply,
      actions: result.actions,
      source: result.source,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Agent generation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
