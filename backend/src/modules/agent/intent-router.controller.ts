import type { Request, Response } from "express";
import { analyzeCustomerMessage } from "./intent-router.service";
import type { ProductContext } from "./product-context.types";

export async function analyzeAgentMessage(req: Request, res: Response) {
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
    const analysis = await analyzeCustomerMessage(message, productContext);

    return res.status(200).json(analysis);
  } catch (error) {
    return res.status(500).json({
      message: "Agent analysis failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
