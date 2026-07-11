import { randomUUID } from "node:crypto";
import type { OrderEntities } from "../agent-brain.types";
import type { ProductContext } from "../product-context.types";
import { calculateOrderTotals } from "./order-pricing.service";

export const orderStatuses = [
  "CONFIRMED",
  "PREPARING",
  "SENT",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];
export type OrderReceiptSendStatus =
  | "NOT_REQUESTED"
  | "PENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED";

export interface ConfirmedOrder {
  id: string;
  publicOrderCode: string;
  customerId: string;
  orderCycleId?: string;
  sellerId?: string;
  customerPhone?: string;
  conversationKey?: string;
  productId?: string;
  productName: string;
  fullName: string;
  phone: string;
  city: string;
  address: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  deliveryPrice: number;
  total: number;
  currency: string;
  status: OrderStatus;
  source: "agent" | "whatsapp_cloud";
  createdAt: string;
  updatedAt: string;
  receiptPdfPath?: string;
  receiptSentAt?: string;
  receiptMediaId?: string;
  receiptSendStatus?: OrderReceiptSendStatus;
  receiptError?: string;
  receiptLocalFileDeleted?: boolean;
  receiptLocalFileDeletedAt?: string;
  receiptLocalFileDeleteError?: string;
}

type SaveConfirmedOrderInput = {
  customerId: string;
  orderCycleId?: string;
  sellerId?: string;
  customerPhone?: string;
  conversationKey?: string;
  productContext: ProductContext;
  collected: OrderEntities;
  source?: "agent" | "whatsapp_cloud";
};

type ListConfirmedOrdersFilters = {
  status?: OrderStatus;
  customerId?: string;
  phone?: string;
  city?: string;
};

const confirmedOrdersById = new Map<string, ConfirmedOrder>();
const confirmedOrderIdsByOrderKey = new Map<string, string>();

function getOrderKey(customerId: string, orderCycleId?: string): string {
  return `${customerId}:${orderCycleId?.trim() || "default"}`;
}

const PUBLIC_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generatePublicOrderCode(): string {
  const existingCodes = new Set(
    Array.from(confirmedOrdersById.values()).map(
      (order) => order.publicOrderCode,
    ),
  );

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const raw = randomUUID().replace(/-/g, "").toUpperCase();
    let code = "";

    for (let index = 0; index < 8; index += 1) {
      const value = Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16);
      code += PUBLIC_CODE_ALPHABET[value % PUBLIC_CODE_ALPHABET.length];
    }

    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;

    if (!existingCodes.has(formatted)) {
      return formatted;
    }
  }

  throw new Error("Unable to generate a unique public order code");
}

function getTextValue(value: string | undefined): string {
  return value?.trim() || "";
}

function matchesOptionalFilter(value: string, filter: string | undefined): boolean {
  if (!filter) {
    return true;
  }

  return value.trim().toLowerCase() === filter.trim().toLowerCase();
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    orderStatuses.includes(value.trim().toUpperCase() as OrderStatus)
  );
}

export function normalizeOrderStatus(value: string): OrderStatus {
  return value.trim().toUpperCase() as OrderStatus;
}

export function saveConfirmedOrder(input: SaveConfirmedOrderInput): ConfirmedOrder {
  const orderKey = getOrderKey(input.customerId, input.orderCycleId);
  const existingOrderId = confirmedOrderIdsByOrderKey.get(orderKey);
  const existingOrder = existingOrderId
    ? confirmedOrdersById.get(existingOrderId)
    : undefined;

  if (existingOrder) {
    return existingOrder;
  }

  const quantity = input.collected.quantity ?? 1;
  const totals = calculateOrderTotals({
    productContext: input.productContext,
    quantity,
  });
  const order: ConfirmedOrder = {
    id: randomUUID(),
    publicOrderCode: generatePublicOrderCode(),
    customerId: input.customerId,
    orderCycleId: input.orderCycleId,
    sellerId: input.sellerId,
    customerPhone: input.customerPhone,
    conversationKey: input.conversationKey,
    productId: input.productContext.productId,
    productName: input.productContext.productName,
    fullName: getTextValue(input.collected.fullName),
    phone: getTextValue(input.collected.phone),
    city: getTextValue(input.collected.city),
    address: getTextValue(input.collected.address),
    size: getTextValue(input.collected.size),
    color: getTextValue(input.collected.color),
    quantity,
    unitPrice: totals.unitPrice,
    subtotal: totals.subtotal,
    deliveryPrice: totals.deliveryPrice,
    total: totals.total,
    currency: totals.currency,
    status: "CONFIRMED",
    source: input.source || "agent",
    receiptSendStatus: "NOT_REQUESTED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  confirmedOrdersById.set(order.id, order);
  confirmedOrderIdsByOrderKey.set(orderKey, order.id);

  return order;
}

export function getConfirmedOrderByCustomerId(
  customerId: string,
  orderCycleId?: string,
): ConfirmedOrder | undefined {
  if (orderCycleId) {
    const orderId = confirmedOrderIdsByOrderKey.get(
      getOrderKey(customerId, orderCycleId),
    );

    return orderId ? confirmedOrdersById.get(orderId) : undefined;
  }

  return Array.from(confirmedOrdersById.values())
    .filter((order) => order.customerId === customerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function listConfirmedOrders(
  filters: ListConfirmedOrdersFilters = {},
): ConfirmedOrder[] {
  return Array.from(confirmedOrdersById.values()).filter((order) => {
    if (filters.status && order.status !== filters.status) {
      return false;
    }

    return (
      matchesOptionalFilter(order.customerId, filters.customerId) &&
      matchesOptionalFilter(order.phone, filters.phone) &&
      matchesOptionalFilter(order.city, filters.city)
    );
  });
}

export function getConfirmedOrderById(id: string): ConfirmedOrder | undefined {
  return confirmedOrdersById.get(id);
}

export function updateConfirmedOrderStatus(
  id: string,
  status: OrderStatus,
): ConfirmedOrder | undefined {
  const order = getConfirmedOrderById(id);

  if (!order) {
    return undefined;
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();

  return order;
}

export function updateConfirmedOrderReceipt(
  id: string,
  receipt: {
    receiptPdfPath?: string;
    receiptSentAt?: string;
    receiptMediaId?: string;
    receiptSendStatus?: OrderReceiptSendStatus;
    receiptError?: string;
    receiptLocalFileDeleted?: boolean;
    receiptLocalFileDeletedAt?: string;
    receiptLocalFileDeleteError?: string;
  },
): ConfirmedOrder | undefined {
  const order = getConfirmedOrderById(id);

  if (!order) {
    return undefined;
  }

  Object.assign(order, receipt);
  order.updatedAt = new Date().toISOString();

  return order;
}
