import type {
  ConfirmedOrder,
  OrderReceiptSendStatus,
} from "../agent/order/confirmed-order-store.service";
import type { ReceiptSendStatus } from "./order-receipt.types";

export const RECEIPT_DATA_INVALID = "RECEIPT_DATA_INVALID" as const;

export type ReceiptSnapshotValidationResult = {
  valid: boolean;
  invalidFields: string[];
  errorCode?: typeof RECEIPT_DATA_INVALID;
};

const textLimits: Array<{
  field: keyof Pick<
    ConfirmedOrder,
    | "publicOrderCode"
    | "productName"
    | "fullName"
    | "phone"
    | "city"
    | "address"
    | "currency"
  >;
  min: number;
  max: number;
}> = [
  { field: "publicOrderCode", min: 3, max: 64 },
  { field: "productName", min: 1, max: 200 },
  { field: "fullName", min: 1, max: 160 },
  { field: "phone", min: 6, max: 32 },
  { field: "city", min: 1, max: 160 },
  { field: "address", min: 1, max: 500 },
  { field: "currency", min: 1, max: 16 },
];

function isBoundedText(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length >= min &&
    value.trim().length <= max
  );
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function amountsEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.001;
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function validateConfirmedOrderReceiptSnapshot(
  order: ConfirmedOrder,
): ReceiptSnapshotValidationResult {
  const invalidFields = new Set<string>();

  if (order.status !== "CONFIRMED") {
    invalidFields.add("status");
  }

  if (
    !order.confirmedAt ||
    Number.isNaN(Date.parse(order.confirmedAt))
  ) {
    invalidFields.add("confirmedAt");
  }

  for (const rule of textLimits) {
    if (!isBoundedText(order[rule.field], rule.min, rule.max)) {
      invalidFields.add(rule.field);
    }
  }

  if (
    !Number.isInteger(order.quantity) ||
    order.quantity < 1 ||
    order.quantity > 10_000
  ) {
    invalidFields.add("quantity");
  }

  const attributes = order.receiptProduct?.attributes || [];

  attributes.forEach((attribute, index) => {
    if (attribute.key !== undefined && !isBoundedText(attribute.key, 1, 80)) {
      invalidFields.add(`receiptProduct.attributes.${index}.key`);
    }

    if (!isBoundedText(attribute.label, 1, 120)) {
      invalidFields.add(`receiptProduct.attributes.${index}.label`);
    }

    if (!isBoundedText(attribute.value, 1, 240)) {
      invalidFields.add(
        attribute.key
          ? `receiptProduct.attributes.${attribute.key}`
          : `receiptProduct.attributes.${index}.value`,
      );
    }

    if (
      attribute.canonicalValue !== undefined &&
      !isBoundedText(attribute.canonicalValue, 1, 240)
    ) {
      invalidFields.add(`receiptProduct.attributes.${index}.canonicalValue`);
    }
  });

  const attributeKeys = new Set(
    attributes
      .map((attribute) => attribute.key)
      .filter((key): key is string => Boolean(key?.trim()))
      .map(normalizeKey),
  );

  for (const requiredKey of order.receiptProduct?.requiredAttributeKeys || []) {
    const normalizedKey = normalizeKey(requiredKey);

    if (
      !isBoundedText(requiredKey, 1, 80) ||
      !normalizedKey ||
      !attributeKeys.has(normalizedKey)
    ) {
      invalidFields.add(`receiptProduct.attributes.${requiredKey}`);
    }
  }

  const pricing = order.pricing;
  const quote = order.deliveryQuote;
  const pricingNumbers = [
    order.unitPrice,
    order.subtotal,
    order.deliveryPrice,
    order.total,
    pricing?.unitPrice,
    pricing?.quantity,
    pricing?.subtotal,
    pricing?.deliveryPrice,
    pricing?.total,
    quote?.amount,
  ];

  if (
    order.deliveryPriceKnown !== true ||
    quote?.status !== "RESOLVED" ||
    pricing?.status !== "COMPLETE" ||
    !pricingNumbers.every(isFiniteNonNegative)
  ) {
    invalidFields.add("pricing");
  } else {
    if (
      !Number.isInteger(pricing.quantity) ||
      pricing.quantity !== order.quantity
    ) {
      invalidFields.add("pricing.quantity");
    }

    if (!amountsEqual(pricing.subtotal, pricing.unitPrice * pricing.quantity)) {
      invalidFields.add("pricing.subtotal");
    }

    if (!amountsEqual(pricing.deliveryPrice, quote.amount)) {
      invalidFields.add("pricing.deliveryPrice");
    }

    if (!amountsEqual(pricing.total, pricing.subtotal + pricing.deliveryPrice)) {
      invalidFields.add("pricing.total");
    }

    if (
      !amountsEqual(order.unitPrice, pricing.unitPrice) ||
      !amountsEqual(order.subtotal, pricing.subtotal) ||
      !amountsEqual(order.deliveryPrice, pricing.deliveryPrice) ||
      !amountsEqual(order.total, pricing.total)
    ) {
      invalidFields.add("pricing.orderSnapshot");
    }
  }

  const result = Array.from(invalidFields);

  return {
    valid: result.length === 0,
    invalidFields: result,
    ...(result.length > 0 ? { errorCode: RECEIPT_DATA_INVALID } : {}),
  };
}

export function canAttemptOrderReceiptSend(input: {
  orderStatus?: OrderReceiptSendStatus;
  recordStatus?: ReceiptSendStatus;
}): { allowed: boolean; reason?: "receipt_pending" | "receipt_already_sent" } {
  const statuses = [input.orderStatus, input.recordStatus];

  if (statuses.includes("SENT")) {
    return { allowed: false, reason: "receipt_already_sent" };
  }

  if (statuses.includes("PENDING")) {
    return { allowed: false, reason: "receipt_pending" };
  }

  return { allowed: true };
}
