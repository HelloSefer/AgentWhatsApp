import { randomUUID } from "node:crypto";
import type { OrderEntities } from "../agent-brain.types";
import type { ProductContext } from "../product-context.types";

export const orderStatuses = [
  "CONFIRMED",
  "PREPARING",
  "SENT",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export interface ConfirmedOrder {
  id: string;
  customerId: string;
  productName: string;
  fullName: string;
  phone: string;
  city: string;
  address: string;
  size: string;
  color: string;
  quantity: number;
  status: OrderStatus;
  createdAt: string;
}

type SaveConfirmedOrderInput = {
  customerId: string;
  productContext: ProductContext;
  collected: OrderEntities;
};

type ListConfirmedOrdersFilters = {
  status?: OrderStatus;
  customerId?: string;
  phone?: string;
  city?: string;
};

const confirmedOrdersByCustomerId = new Map<string, ConfirmedOrder>();

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
  const existingOrder = confirmedOrdersByCustomerId.get(input.customerId);

  if (existingOrder) {
    return existingOrder;
  }

  const order: ConfirmedOrder = {
    id: randomUUID(),
    customerId: input.customerId,
    productName: input.productContext.productName,
    fullName: getTextValue(input.collected.fullName),
    phone: getTextValue(input.collected.phone),
    city: getTextValue(input.collected.city),
    address: getTextValue(input.collected.address),
    size: getTextValue(input.collected.size),
    color: getTextValue(input.collected.color),
    quantity: input.collected.quantity ?? 1,
    status: "CONFIRMED",
    createdAt: new Date().toISOString(),
  };

  confirmedOrdersByCustomerId.set(input.customerId, order);

  return order;
}

export function listConfirmedOrders(
  filters: ListConfirmedOrdersFilters = {},
): ConfirmedOrder[] {
  return Array.from(confirmedOrdersByCustomerId.values()).filter((order) => {
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
  return Array.from(confirmedOrdersByCustomerId.values()).find(
    (order) => order.id === id,
  );
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

  return order;
}
