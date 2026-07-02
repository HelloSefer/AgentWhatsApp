import type { Request, Response } from "express";
import { generateAgentReply } from "./agent.service";
import type { ProductContext } from "./product-context.types";

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
    const reply = await generateAgentReply(message, productContext);

    return res.status(200).json({
      reply,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Agent generation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}


