import type { Request, Response } from "express";
import { generateAgentResult, resolveAgentIdentity } from "./agent.service";
import { analyzeAIIntentWithMeta } from "./ai/ai-intent-router.service";
import { evaluateIntentRouter } from "./ai/ai-intent-router-eval.service";
import type { IntentEvalCase } from "./ai/ai-intent-router-eval.service";
import { aiIntentRouterIntentValues } from "./ai/ai-intent-router.schema";
import { evaluateSalesReplies } from "./sales/sales-response-eval.service";
import type { SalesReplyEvalCase } from "./sales/sales-response-eval.service";
import {
  benchmarkNaturalReplies,
  evaluateNaturalReplies,
} from "./natural-reply/natural-reply-eval.service";
import type { NaturalReplyEvalCase } from "./natural-reply/natural-reply-eval.service";
import {
  getNaturalReplyStatus,
  resetNaturalReplyState,
  smokeTestNaturalReply,
} from "./natural-reply/natural-reply-generator.service";
import { evaluateSellerBrain } from "./seller-brain/seller-brain-eval.service";
import type { SellerBrainEvalCase } from "./seller-brain/seller-brain.types";
import { evaluateConversationScenarios } from "./conversation-scenario-eval.service";
import {
  adminNotificationTypes,
  deleteAdminNotification,
  getAdminNotificationById,
  isAdminNotificationType,
  listAdminNotifications,
  markAllAdminNotificationsRead,
  markAdminNotificationRead,
} from "./admin/admin-notification.service";
import type { AdminNotificationType } from "./admin/admin-notification.service";
import {
  getConfirmedOrderById,
  isOrderStatus,
  listConfirmedOrders,
  normalizeOrderStatus,
  updateConfirmedOrderStatus,
  orderStatuses,
} from "./order/confirmed-order-store.service";
import { getConversationSession } from "./session/conversation-session.service";
import type { ConversationOrderState } from "./agent-brain.types";
import type { ProductContext } from "./product-context.types";

function isAIIntentRouterIntent(value: unknown): boolean {
  return (
    typeof value === "string" &&
    aiIntentRouterIntentValues.includes(
      value as (typeof aiIntentRouterIntentValues)[number],
    )
  );
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getOptionalBooleanQuery(
  value: unknown,
): boolean | "invalid" | undefined {
  const text = getOptionalString(value)?.toLowerCase();

  if (!text) {
    return undefined;
  }

  if (text === "true") {
    return true;
  }

  if (text === "false") {
    return false;
  }

  return "invalid";
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
      customerPhone: getOptionalString(req.body?.customerPhone),
      conversationKey: getOptionalString(req.body?.conversationKey),
      sellerId: getOptionalString(req.body?.sellerId),
      productId: getOptionalString(req.body?.productId),
      phoneNumberId: getOptionalString(req.body?.phoneNumberId),
      useMemory: req.body?.useMemory === true,
    });

    return res.status(200).json({
      reply: result.reply,
      actions: result.actions,
      source: result.source,
      meta: result.meta,
      identity: result.meta?.identity,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Agent generation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function testAgentIntent(req: Request, res: Response) {
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
    const customerId = getOptionalString(req.body?.customerId);
    const customerPhone = getOptionalString(req.body?.customerPhone);
    const conversationKey = getOptionalString(req.body?.conversationKey);
    const sellerId = getOptionalString(req.body?.sellerId);
    const productId = getOptionalString(req.body?.productId);
    const identity = resolveAgentIdentity({
      customerId,
      customerPhone,
      conversationKey,
      sellerId,
      productId,
      phoneNumberId: getOptionalString(req.body?.phoneNumberId),
    });
    const memoryCustomerId = identity?.conversationKey || customerId;
    const requestOrderState =
      typeof req.body?.orderState === "object" && req.body.orderState !== null
        ? (req.body.orderState as ConversationOrderState)
        : undefined;
    const sessionContext =
      req.body?.useMemory === true && memoryCustomerId
        ? await getConversationSession(
            memoryCustomerId,
            identity?.sellerId || sellerId,
            productId,
            identity?.customerPhone || customerPhone,
          )
        : undefined;
    const result = await analyzeAIIntentWithMeta({
      message,
      productContext,
      sessionContext,
      orderState: requestOrderState,
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "AI intent routing failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentIntents(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const cases: unknown[] | undefined =
      Array.isArray(req.body?.cases) && req.body.cases.length
        ? req.body.cases
        : undefined;

    if (cases) {
      const invalidCase = cases.find((testCase) => {
        if (
          typeof testCase !== "object" ||
          testCase === null ||
          Array.isArray(testCase)
        ) {
          return true;
        }

        const candidate = testCase as Record<string, unknown>;

        return (
          typeof candidate.message !== "string" ||
          !candidate.message.trim() ||
          !isAIIntentRouterIntent(candidate.expectedIntent)
        );
      });

      if (invalidCase) {
        return res.status(400).json({
          message:
            "Each case requires message and a supported expectedIntent",
          allowedIntents: aiIntentRouterIntentValues,
        });
      }
    }

    const report = await evaluateIntentRouter({
      productContext,
      cases: cases as IntentEvalCase[] | undefined,
    });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Intent evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentReplies(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const cases: unknown[] | undefined =
      Array.isArray(req.body?.cases) && req.body.cases.length
        ? req.body.cases
        : undefined;

    if (cases) {
      const invalidCase = cases.find((testCase) => {
        if (typeof testCase === "string") {
          return !testCase.trim();
        }

        if (
          typeof testCase !== "object" ||
          testCase === null ||
          Array.isArray(testCase)
        ) {
          return true;
        }

        const candidate = testCase as Record<string, unknown>;

        return typeof candidate.message !== "string" || !candidate.message.trim();
      });

      if (invalidCase) {
        return res.status(400).json({
          message: "Each reply eval case must be a message string or an object with message",
        });
      }
    }

    const normalizedCases = cases?.map((testCase) =>
      typeof testCase === "string"
        ? { message: testCase }
        : (testCase as SalesReplyEvalCase),
    );
    const report = await evaluateSalesReplies({
      productContext,
      cases: normalizedCases,
    });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Reply evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentNaturalReplies(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const cases: unknown[] | undefined =
      Array.isArray(req.body?.cases) && req.body.cases.length
        ? req.body.cases
        : undefined;

    if (cases) {
      const invalidCase = cases.find((testCase) => {
        if (typeof testCase === "string") {
          return !testCase.trim();
        }

        if (
          typeof testCase !== "object" ||
          testCase === null ||
          Array.isArray(testCase)
        ) {
          return true;
        }

        const candidate = testCase as Record<string, unknown>;

        return typeof candidate.message !== "string" || !candidate.message.trim();
      });

      if (invalidCase) {
        return res.status(400).json({
          message:
            "Each natural reply eval case must be a message string or an object with message",
        });
      }
    }

    const normalizedCases = cases?.map((testCase) =>
      typeof testCase === "string"
        ? { message: testCase }
        : (testCase as NaturalReplyEvalCase),
    );
    const report = await evaluateNaturalReplies({
      productContext,
      cases: normalizedCases,
    });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Natural reply evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function getAgentNaturalReplyStatus(_req: Request, res: Response) {
  return res.status(200).json(getNaturalReplyStatus());
}

export function resetAgentNaturalReplyState(_req: Request, res: Response) {
  resetNaturalReplyState();

  return res.status(200).json({
    ok: true,
    message: "Natural reply state reset.",
  });
}

export async function smokeAgentNaturalReply(req: Request, res: Response) {
  const message =
    typeof req.body?.message === "string"
      ? req.body.message
      : "صراحة غالية عليا";

  if (!message.trim()) {
    return res.status(400).json({
      message: "Message is required",
    });
  }

  try {
    const result = await smokeTestNaturalReply(message);

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Natural reply smoke test failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function benchmarkAgentNaturalReply(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const result = await benchmarkNaturalReplies({ productContext });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      message: "Natural reply benchmark failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentSellerBrain(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const cases: unknown[] | undefined =
      Array.isArray(req.body?.cases) && req.body.cases.length
        ? req.body.cases
        : undefined;

    if (cases) {
      const invalidCase = cases.find((testCase) => {
        if (typeof testCase === "string") {
          return !testCase.trim();
        }

        if (
          typeof testCase !== "object" ||
          testCase === null ||
          Array.isArray(testCase)
        ) {
          return true;
        }

        const candidate = testCase as Record<string, unknown>;

        return typeof candidate.message !== "string" || !candidate.message.trim();
      });

      if (invalidCase) {
        return res.status(400).json({
          message:
            "Each seller brain eval case must be a message string or an object with message",
        });
      }
    }

    const normalizedCases = cases?.map((testCase) =>
      typeof testCase === "string"
        ? { message: testCase }
        : (testCase as SellerBrainEvalCase),
    );
    const report = await evaluateSellerBrain({
      productContext,
      cases: normalizedCases,
    });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Seller brain evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function evalAgentConversationScenarios(req: Request, res: Response) {
  try {
    const productContext =
      typeof req.body?.productContext === "object" &&
      req.body.productContext !== null
        ? (req.body.productContext as ProductContext)
        : undefined;
    const report = await evaluateConversationScenarios({ productContext });

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Conversation scenario evaluation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function listAgentOrders(req: Request, res: Response) {
  const status = getOptionalString(req.query.status);

  if (status && !isOrderStatus(status)) {
    return res.status(400).json({
      message: "Invalid order status",
      allowedStatuses: orderStatuses,
    });
  }

  return res.status(200).json({
    orders: listConfirmedOrders({
      status: status ? normalizeOrderStatus(status) : undefined,
      customerId: getOptionalString(req.query.customerId),
      phone: getOptionalString(req.query.phone),
      city: getOptionalString(req.query.city),
    }),
  });
}

export function getAgentOrder(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const order = id ? getConfirmedOrderById(id) : undefined;

  if (!order) {
    return res.status(404).json({
      message: "Order not found",
    });
  }

  return res.status(200).json({
    order,
  });
}

export function listAgentAdminNotifications(req: Request, res: Response) {
  const isRead = getOptionalBooleanQuery(req.query.isRead);
  const type = getOptionalString(req.query.type);

  if (isRead === "invalid") {
    return res.status(400).json({
      message: "isRead must be true or false",
    });
  }

  if (type && !isAdminNotificationType(type)) {
    return res.status(400).json({
      message: "Invalid notification type",
      allowedTypes: adminNotificationTypes,
    });
  }

  const notificationType: AdminNotificationType | undefined = type
    ? (type as AdminNotificationType)
    : undefined;

  return res.status(200).json({
    notifications: listAdminNotifications({
      isRead,
      type: notificationType,
      customerId: getOptionalString(req.query.customerId),
      orderId: getOptionalString(req.query.orderId),
    }),
  });
}

export function getAgentAdminNotification(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const notification = id ? getAdminNotificationById(id) : undefined;

  if (!notification) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    notification,
  });
}

export function markAgentAdminNotificationRead(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const notification = id ? markAdminNotificationRead(id) : undefined;

  if (!notification) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    notification,
  });
}

export function markAllAgentAdminNotificationsRead(_req: Request, res: Response) {
  return res.status(200).json({
    updatedCount: markAllAdminNotificationsRead(),
  });
}

export function deleteAgentAdminNotification(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const notification = id ? deleteAdminNotification(id) : undefined;

  if (!notification) {
    return res.status(404).json({
      message: "Notification not found",
    });
  }

  return res.status(200).json({
    notification,
  });
}

export function updateAgentOrderStatus(req: Request, res: Response) {
  const id = getOptionalString(req.params.id);
  const status = getOptionalString(req.body?.status);

  if (!status || !isOrderStatus(status)) {
    return res.status(400).json({
      message: "Invalid order status",
      allowedStatuses: orderStatuses,
    });
  }

  const order = id
    ? updateConfirmedOrderStatus(id, normalizeOrderStatus(status))
    : undefined;

  if (!order) {
    return res.status(404).json({
      message: "Order not found",
    });
  }

  return res.status(200).json({
    order,
  });
}
