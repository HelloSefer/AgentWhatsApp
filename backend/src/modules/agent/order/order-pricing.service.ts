import type { ProductContext } from "../product-context.types";
import type { ResolvedDeliveryQuote } from "./delivery-pricing.service";

export type OrderTotals = {
  unitPrice: number;
  quantity: number;
  subtotal: number;
  deliveryPrice: number;
  total: number;
  currency: string;
  deliveryPriceLabel: string;
  deliveryPriceKnown: boolean;
  status: "COMPLETE" | "INCOMPLETE";
};

function toMoney(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value ?? "").replace(",", "."));

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatMoney(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function getOrderCurrency(productContext: ProductContext): string {
  const currency = productContext.currency?.trim();

  if (!currency || currency === "MAD") {
    return "درهم";
  }

  return currency;
}

export function calculateOrderTotals(input: {
  productContext: ProductContext;
  quantity?: number;
  deliveryQuote?: ResolvedDeliveryQuote;
}): OrderTotals {
  const unitPrice = toMoney(input.productContext.price);
  const quantity = Math.max(1, Math.trunc(input.quantity || 1));
  const subtotal = unitPrice * quantity;
  const configuredDeliveryPrice = input.productContext.deliveryPrice;
  const deliveryPrice = input.deliveryQuote
    ? input.deliveryQuote.amount
    : toMoney(configuredDeliveryPrice);
  const currency = input.deliveryQuote?.currency === "MAD"
    ? "درهم"
    : getOrderCurrency(input.productContext);
  const deliveryPriceKnown = Boolean(input.deliveryQuote) ||
    input.productContext.deliveryIsFree === true ||
    typeof configuredDeliveryPrice === "number";
  const deliveryPriceLabel = input.deliveryQuote?.type === "FREE" ||
    input.productContext.deliveryIsFree
    ? "مجانية"
    : deliveryPriceKnown
      ? `${formatMoney(deliveryPrice)} ${currency}`
      : "غير محددة";

  return {
    unitPrice,
    quantity,
    subtotal,
    deliveryPrice,
    total: subtotal + deliveryPrice,
    currency,
    deliveryPriceLabel,
    deliveryPriceKnown,
    status: deliveryPriceKnown ? "COMPLETE" : "INCOMPLETE",
  };
}

export function formatOrderMoney(value: number): string {
  return formatMoney(value);
}
