import type { Request, Response } from "express";
import { generateAgentResult } from "./agent.service";
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
import type { ProductContext } from "./product-context.types";

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
