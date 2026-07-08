import type { Request, Response } from "express";
import type { ConversationMessage, OrderEntities } from "../agent-brain.types";
import {
  appendConversationMessage,
  buildSessionKey,
  clearConversationSession,
  getConversationSession,
  updateConversationOrderState,
} from "./conversation-session.service";
import { conversationKeyService } from "../identity/conversation-key.service";
import { DEFAULT_DEMO_SELLER_ID } from "../identity/seller-resolver.service";

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type SessionRequestIdentity = {
  customerId: string;
  customerPhone?: string;
  conversationKey?: string;
  sellerId?: string;
  productId?: string;
};

function getIdentityValue(
  req: Request,
  field: string,
  source: "query" | "body" | "both" = "both",
): string | undefined {
  if (source === "query" || source === "both") {
    const queryValue = getOptionalString(req.query[field]);

    if (queryValue) {
      return queryValue;
    }
  }

  if (source === "body" || source === "both") {
    return getOptionalString(req.body?.[field]);
  }

  return undefined;
}

function resolveSessionIdentity(
  req: Request,
  source: "query" | "body" | "both" = "both",
): SessionRequestIdentity | undefined {
  const routeCustomerId = getOptionalString(req.params.customerId);

  if (!routeCustomerId) {
    return undefined;
  }

  const sellerId =
    getIdentityValue(req, "sellerId", source) || DEFAULT_DEMO_SELLER_ID;
  const productId = getIdentityValue(req, "productId", source);
  const conversationKey = getIdentityValue(req, "conversationKey", source);
  const customerPhone =
    getIdentityValue(req, "customerPhone", source) || routeCustomerId;

  if (conversationKey) {
    return {
      customerId: conversationKey,
      customerPhone,
      conversationKey,
      sellerId,
      productId,
    };
  }

  const builtConversationKey = conversationKeyService.buildConversationKey(
    sellerId,
    customerPhone,
  );

  return {
    customerId: builtConversationKey,
    customerPhone,
    conversationKey: builtConversationKey,
    sellerId,
    productId,
  };
}

function buildSessionDiagnostics(identity: SessionRequestIdentity) {
  const sellerId = identity.sellerId || DEFAULT_DEMO_SELLER_ID;
  const customerPhone = identity.customerPhone || identity.customerId;
  const conversationKey =
    identity.conversationKey ||
    conversationKeyService.buildConversationKey(sellerId, customerPhone);

  return {
    identity: {
      sellerId,
      customerPhone,
      conversationKey,
    },
    sessionKey: buildSessionKey(conversationKey, sellerId, identity.productId),
  };
}

function isConversationRole(value: unknown): value is ConversationMessage["role"] {
  return value === "customer" || value === "agent" || value === "system";
}

export async function getSession(req: Request, res: Response) {
  const identity = resolveSessionIdentity(req, "query");

  if (!identity) {
    return res.status(400).json({
      message: "Customer ID is required",
    });
  }

  try {
    const session = await getConversationSession(
      identity.customerId,
      identity.sellerId,
      identity.productId,
      identity.customerPhone,
    );
    const diagnostics = buildSessionDiagnostics(identity);

    return res.status(200).json({
      ...session,
      ...diagnostics,
      exists: true,
      messageCount: session.messages.length,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to get conversation session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function appendMessage(req: Request, res: Response) {
  const identity = resolveSessionIdentity(req, "both");
  const role = req.body?.role;
  const text = typeof req.body?.text === "string" ? req.body.text : "";

  if (!identity) {
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
      customerId: identity.customerId,
      customerPhone: identity.customerPhone,
      conversationKey: identity.conversationKey,
      sellerId: identity.sellerId,
      productId: identity.productId,
      role,
      text,
    });
    const diagnostics = buildSessionDiagnostics(identity);

    return res.status(200).json({
      ...session,
      ...diagnostics,
      exists: true,
      messageCount: session.messages.length,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to append conversation message",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function updateOrderState(req: Request, res: Response) {
  const identity = resolveSessionIdentity(req, "both");

  if (!identity) {
    return res.status(400).json({
      message: "Customer ID is required",
    });
  }

  try {
    const session = await updateConversationOrderState({
      customerId: identity.customerId,
      customerPhone: identity.customerPhone,
      conversationKey: identity.conversationKey,
      sellerId: identity.sellerId,
      productId: identity.productId,
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
    const diagnostics = buildSessionDiagnostics(identity);

    return res.status(200).json({
      ...session,
      ...diagnostics,
      exists: true,
      messageCount: session.messages.length,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update conversation order state",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function clearSession(req: Request, res: Response) {
  const identity = resolveSessionIdentity(req, "both");

  if (!identity) {
    return res.status(400).json({
      message: "Customer ID is required",
    });
  }

  try {
    const deleted = await clearConversationSession(
      identity.customerId,
      identity.sellerId,
      identity.productId,
    );
    const diagnostics = buildSessionDiagnostics(identity);

    return res.status(200).json({
      ok: true,
      deleted,
      ...diagnostics,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to clear conversation session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
