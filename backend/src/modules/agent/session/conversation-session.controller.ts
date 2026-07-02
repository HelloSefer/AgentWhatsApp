import type { Request, Response } from "express";
import type { ConversationMessage, OrderEntities } from "../agent-brain.types";
import {
  appendConversationMessage,
  clearConversationSession,
  getConversationSession,
  updateConversationOrderState,
} from "./conversation-session.service";

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getCustomerId(req: Request): string | undefined {
  return getOptionalString(req.params.customerId);
}

function isConversationRole(value: unknown): value is ConversationMessage["role"] {
  return value === "customer" || value === "agent" || value === "system";
}

export async function getSession(req: Request, res: Response) {
  const customerId = getCustomerId(req);

  if (!customerId) {
    return res.status(400).json({
      message: "Customer ID is required",
    });
  }

  try {
    const session = await getConversationSession(
      customerId,
      getOptionalString(req.query.sellerId),
      getOptionalString(req.query.productId),
    );

    return res.status(200).json(session);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to get conversation session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function appendMessage(req: Request, res: Response) {
  const customerId = getCustomerId(req);
  const role = req.body?.role;
  const text = typeof req.body?.text === "string" ? req.body.text : "";

  if (!customerId) {
    return res.status(400).json({
      message: "Customer ID is required",
    });
  }

  if (!isConversationRole(role)) {
    return res.status(400).json({
      message: "Role must be customer, agent, or system",
    });
  }

  if (!text.trim()) {
    return res.status(400).json({
      message: "Text is required",
    });
  }

  try {
    const session = await appendConversationMessage({
      customerId,
      sellerId: getOptionalString(req.body?.sellerId),
      productId: getOptionalString(req.body?.productId),
      role,
      text,
    });

    return res.status(200).json(session);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to append conversation message",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function updateOrderState(req: Request, res: Response) {
  const customerId = getCustomerId(req);

  if (!customerId) {
    return res.status(400).json({
      message: "Customer ID is required",
    });
  }

  try {
    const session = await updateConversationOrderState({
      customerId,
      sellerId: getOptionalString(req.body?.sellerId),
      productId: getOptionalString(req.body?.productId),
      collected:
        typeof req.body?.collected === "object" && req.body.collected !== null
          ? (req.body.collected as Partial<OrderEntities>)
          : undefined,
      missingFields: Array.isArray(req.body?.missingFields)
        ? req.body.missingFields.filter(
            (field: unknown): field is string => typeof field === "string",
          )
        : undefined,
      isComplete:
        typeof req.body?.isComplete === "boolean"
          ? req.body.isComplete
          : undefined,
    });

    return res.status(200).json(session);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update conversation order state",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function clearSession(req: Request, res: Response) {
  const customerId = getCustomerId(req);

  if (!customerId) {
    return res.status(400).json({
      message: "Customer ID is required",
    });
  }

  try {
    await clearConversationSession(
      customerId,
      getOptionalString(req.body?.sellerId),
      getOptionalString(req.body?.productId),
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to clear conversation session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
