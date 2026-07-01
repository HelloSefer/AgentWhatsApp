import type { Request, Response } from "express";
import { generateAIReply } from "./ai.service";

export async function testAIReply(req: Request, res: Response) {
  const message = typeof req.body?.message === "string" ? req.body.message : "";

  if (!message.trim()) {
    return res.status(400).json({
      message: "Message is required",
    });
  }

  try {
    const reply = await generateAIReply(message);

    return res.status(200).json({
      reply,
    });
  } catch (error) {
    return res.status(500).json({
      message: "AI generation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
