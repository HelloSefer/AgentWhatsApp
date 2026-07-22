import { buildConfirmedOrderReceiptModel } from "../../confirmed-order/confirmed-order-receipt.service";
import type { ConfirmedOrderSnapshot } from "../../confirmed-order/confirmed-order-snapshot.types";
import { ConfirmedOrderValidationError } from "./order-persistence.errors";

const MAX_ORDER_ID = 128;
const MAX_PHONE = 32;
const MAX_IDEMPOTENCY_KEY = 160;

function required(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw new ConfirmedOrderValidationError();
  const result = value.trim();
  if (!result || result.length > maximum) throw new ConfirmedOrderValidationError();
  return result;
}

function safeMoney(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ConfirmedOrderValidationError();
  return value as number;
}

function deliveryDetails(snapshot: ConfirmedOrderSnapshot): Readonly<Record<string, string | number | boolean>> {
  const result: Record<string, string | number | boolean> = {};
  for (const field of snapshot.orderFields) {
    if (!field.key.trim() || !["string", "number", "boolean"].includes(typeof field.value)) throw new ConfirmedOrderValidationError();
    result[field.key] = field.value;
  }
  return result;
}

export function validateConfirmedOrderPersistenceInput(input: unknown): Readonly<{
  snapshot: ConfirmedOrderSnapshot;
  orderId: string;
  customerPhone: string;
  idempotencyKey: string;
  deliveryDetails: Readonly<Record<string, string | number | boolean>>;
}> {
  if (typeof input !== "object" || input === null) throw new ConfirmedOrderValidationError();
  const source = input as { snapshot?: unknown; confirmationIdempotencyKey?: unknown };
  const snapshot = source.snapshot as ConfirmedOrderSnapshot;
  if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== 1 || !Object.isFrozen(snapshot)) throw new ConfirmedOrderValidationError();
  try {
    if (!buildConfirmedOrderReceiptModel(snapshot).success) throw new ConfirmedOrderValidationError();
  } catch (error) {
    if (error instanceof ConfirmedOrderValidationError) throw error;
    throw new ConfirmedOrderValidationError();
  }
  const orderId = required(snapshot.id, MAX_ORDER_ID);
  const phoneField = snapshot.orderFields.find((field) => field.key.trim().toLocaleLowerCase() === "phone");
  const customerPhone = required(phoneField?.value, MAX_PHONE);
  if (!/^[A-Z]{3}$/u.test(snapshot.currency) || !snapshot.items.length) throw new ConfirmedOrderValidationError();
  const subtotal = safeMoney(snapshot.merchandiseTotalMinor);
  const delivery = safeMoney(snapshot.deliveryFee?.amountMinor || 0);
  const total = safeMoney(snapshot.finalTotalMinor);
  if (total !== subtotal + delivery || snapshot.items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !Number.isSafeInteger(item.unitPriceMinor) || !Number.isSafeInteger(item.lineTotalMinor) || item.unitPriceMinor < 0 || item.lineTotalMinor < 0 || item.lineTotalMinor !== item.unitPriceMinor * item.quantity || !Array.isArray(item.selectedOptions))) throw new ConfirmedOrderValidationError();
  return { snapshot, orderId, customerPhone, idempotencyKey: required(source.confirmationIdempotencyKey, MAX_IDEMPOTENCY_KEY), deliveryDetails: deliveryDetails(snapshot) };
}
