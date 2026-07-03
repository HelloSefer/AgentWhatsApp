import { randomUUID } from "node:crypto";
import type { ConfirmedOrder } from "../order/confirmed-order-store.service";

export const adminNotificationTypes = ["NEW_CONFIRMED_ORDER"] as const;

export type AdminNotificationType = (typeof adminNotificationTypes)[number];

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  orderId: string;
  customerId: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

type ListAdminNotificationsFilters = {
  isRead?: boolean;
  type?: AdminNotificationType;
  customerId?: string;
  orderId?: string;
};

const notificationsByOrderId = new Map<string, AdminNotification>();
const notificationOrder: string[] = [];

function buildNewConfirmedOrderMessage(order: ConfirmedOrder): string {
  return [
    "طلب جديد مؤكد:",
    `الاسم: ${order.fullName}`,
    `الهاتف: ${order.phone}`,
    `المدينة: ${order.city}`,
    `العنوان: ${order.address}`,
    `المنتج: ${order.productName}`,
    `المقاس: ${order.size}`,
    `اللون: ${order.color}`,
    `الكمية: ${order.quantity}`,
  ].join("\n");
}

function matchesOptionalFilter(value: string, filter: string | undefined): boolean {
  if (!filter) {
    return true;
  }

  return value.trim().toLowerCase() === filter.trim().toLowerCase();
}

export function isAdminNotificationType(
  value: unknown,
): value is AdminNotificationType {
  return (
    typeof value === "string" &&
    adminNotificationTypes.includes(value.trim() as AdminNotificationType)
  );
}

export function createNewConfirmedOrderNotification(
  order: ConfirmedOrder,
): AdminNotification {
  const existingNotification = notificationsByOrderId.get(order.id);

  if (existingNotification) {
    return existingNotification;
  }

  const notification: AdminNotification = {
    id: randomUUID(),
    type: "NEW_CONFIRMED_ORDER",
    orderId: order.id,
    customerId: order.customerId,
    title: "طلب جديد مؤكد",
    message: buildNewConfirmedOrderMessage(order),
    isRead: false,
    createdAt: new Date().toISOString(),
  };

  notificationsByOrderId.set(order.id, notification);
  notificationOrder.unshift(order.id);

  return notification;
}

export function listAdminNotifications(
  filters: ListAdminNotificationsFilters = {},
): AdminNotification[] {
  return notificationOrder
    .map((orderId) => notificationsByOrderId.get(orderId))
    .filter(
      (notification): notification is AdminNotification => Boolean(notification),
    )
    .filter((notification) => {
      if (typeof filters.isRead === "boolean" && notification.isRead !== filters.isRead) {
        return false;
      }

      if (filters.type && notification.type !== filters.type) {
        return false;
      }

      return (
        matchesOptionalFilter(notification.customerId, filters.customerId) &&
        matchesOptionalFilter(notification.orderId, filters.orderId)
      );
    });
}

export function getAdminNotificationById(
  notificationId: string,
): AdminNotification | undefined {
  return listAdminNotifications().find((item) => item.id === notificationId);
}

export function markAdminNotificationRead(
  notificationId: string,
): AdminNotification | undefined {
  const notification = getAdminNotificationById(notificationId);

  if (!notification) {
    return undefined;
  }

  notification.isRead = true;

  return notification;
}

export function markAllAdminNotificationsRead(): number {
  let updatedCount = 0;

  for (const notification of listAdminNotifications()) {
    if (!notification.isRead) {
      notification.isRead = true;
      updatedCount += 1;
    }
  }

  return updatedCount;
}

export function deleteAdminNotification(
  notificationId: string,
): AdminNotification | undefined {
  const notification = getAdminNotificationById(notificationId);

  if (!notification) {
    return undefined;
  }

  notificationsByOrderId.delete(notification.orderId);
  const orderIndex = notificationOrder.indexOf(notification.orderId);

  if (orderIndex >= 0) {
    notificationOrder.splice(orderIndex, 1);
  }

  return notification;
}
