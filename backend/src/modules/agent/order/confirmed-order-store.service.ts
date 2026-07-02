import { randomUUID } from "node:crypto";
import type { OrderEntities } from "../agent-brain.types";
import type { ProductContext } from "../product-context.types";

export type ConfirmedOrderStatus = "CONFIRMED";

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
  status: ConfirmedOrderStatus;
  createdAt: string;
}

type SaveConfirmedOrderInput = {
  customerId: string;
  productContext: ProductContext;
  collected: OrderEntities;
};

const confirmedOrdersByCustomerId = new Map<string, ConfirmedOrder>();

function getTextValue(value: string | undefined): string {
  return value?.trim() || "";
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

export function listConfirmedOrders(): ConfirmedOrder[] {
  return Array.from(confirmedOrdersByCustomerId.values());
}
