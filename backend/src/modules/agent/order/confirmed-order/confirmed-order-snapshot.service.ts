import { resolveCartFieldScope } from "../cart-state.service";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import type { CartPricingQuote } from "../pricing/cart-pricing.types";
import { resolveReviewDeliveryFee } from "../delivery-confirmation/delivery-review-pricing.service";
import {
  validateConfirmedOrderSnapshotInput,
} from "./confirmed-order-snapshot-validator.service";
import {
  CONFIRMED_ORDER_SNAPSHOT_SCHEMA_VERSION,
} from "./confirmed-order-snapshot.types";
import type {
  ConfirmedOrderRecommendedOfferSnapshot,
  ConfirmedOrderSelectedOfferSnapshot,
  ConfirmedOrderSnapshot,
  ConfirmedOrderSnapshotInput,
  ConfirmedOrderSnapshotItem,
  ConfirmedOrderSnapshotResult,
} from "./confirmed-order-snapshot.types";

const MONEY_SCALE = 100;

function text(value: string, maxLength: number): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function toMinor(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const scaled = value * MONEY_SCALE;
  const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 0.0000001
    ? rounded
    : undefined;
}

function fromMinor(value: number): number {
  return value / MONEY_SCALE;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function optionLabels(input: ConfirmedOrderSnapshotInput): Map<string, string> {
  return new Map(
    input.requiredFields
      .filter((field) => resolveCartFieldScope(field) === "ITEM")
      .map((field) => [field.key.trim().toLocaleLowerCase(), text(field.label || field.key, 120)]),
  );
}

function buildItems(input: {
  source: ConfirmedOrderSnapshotInput;
  quote: CartPricingQuote;
}): ConfirmedOrderSnapshotItem[] | undefined {
  const lines = new Map(input.quote.lines.map((line) => [line.cartItemId, line]));
  const labels = optionLabels(input.source);
  const items: ConfirmedOrderSnapshotItem[] = [];

  for (const item of input.source.cart!.items) {
    const line = lines.get(item.id);
    if (!line || line.productId !== item.productId || line.quantity !== item.quantity) return undefined;
    const unitPriceMinor = toMinor(line.unitPrice);
    const lineTotalMinor = toMinor(line.standardLineTotal);
    if (
      unitPriceMinor === undefined ||
      lineTotalMinor === undefined ||
      unitPriceMinor * item.quantity !== lineTotalMinor
    ) {
      return undefined;
    }
    items.push({
      itemId: text(item.id, 120),
      productId: text(item.productId, 120),
      productName: text(input.source.productContext.name, 200),
      quantity: item.quantity,
      selectedOptions: Object.entries(item.selectedOptions)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({
          key: text(key, 80),
          label: labels.get(key.trim().toLocaleLowerCase()) || text(key, 120),
          value: typeof value === "string" ? text(value, 240) : value,
        })),
      unitPriceMinor,
      lineTotalMinor,
      unitPrice: fromMinor(unitPriceMinor),
      lineTotal: fromMinor(lineTotalMinor),
    });
  }

  return items;
}

function buildSelectedOffer(quote: CartPricingQuote): ConfirmedOrderSelectedOfferSnapshot | undefined {
  if (!quote.appliedOfferId || quote.offerTotal === undefined) return undefined;
  const offerTotalMinor = toMinor(quote.offerTotal);
  const discountMinor = toMinor(quote.discountAmount);
  if (offerTotalMinor === undefined || discountMinor === undefined) return undefined;
  return {
    offerId: text(quote.appliedOfferId, 128),
    ...(quote.appliedOfferLabel ? { label: text(quote.appliedOfferLabel, 160) } : {}),
    offerTotalMinor,
    discountMinor,
    offerTotal: fromMinor(offerTotalMinor),
    discountAmount: fromMinor(discountMinor),
  };
}

function buildRecommendedOffer(input: {
  source: ConfirmedOrderSnapshotInput;
  commercial: CartCommercialEvaluation;
}): ConfirmedOrderRecommendedOfferSnapshot | undefined {
  const recommended = input.source.offerLookup.offers.find(
    (offer) => offer.id === input.source.confirmedPreview?.selectedOffer?.offerId,
  );
  if (recommended) return undefined;

  const offer = input.commercial.recommendedOffer;
  if (!offer) return undefined;
  const totalMinor = toMinor(offer.pricing.merchandiseTotal);
  if (totalMinor === undefined) return undefined;
  return {
    offerId: text(offer.offerId, 128),
    ...(offer.pricing.appliedOfferLabel ? { label: text(offer.pricing.appliedOfferLabel, 160) } : {}),
    totalMinor,
    total: fromMinor(totalMinor),
  };
}

/** Builds a detached, immutable record from a validated Phase 6.3F preview. */
export function createConfirmedOrderSnapshot(
  input: ConfirmedOrderSnapshotInput,
): ConfirmedOrderSnapshotResult {
  const validation = validateConfirmedOrderSnapshotInput(input);
  if (!validation.valid || !validation.cart || !validation.requirements || !validation.commercialEvaluation || !validation.snapshotId || !validation.confirmedAt) {
    return {
      success: false,
      ...(validation.failureCode ? { failureCode: validation.failureCode } : {}),
      warnings: [...validation.warnings],
    };
  }

  const standard = validation.commercialEvaluation.standardPricing;
  const cart = validation.cart;
  const selectedPricing = validation.commercialEvaluation.selectedOffer?.eligible
    ? validation.commercialEvaluation.selectedOffer.pricing
    : undefined;
  if (!standard) {
    return { success: false, failureCode: "COMMERCIAL_STATE_BLOCKED", warnings: [...validation.warnings] };
  }
  const items = buildItems({ source: { ...input, cart }, quote: standard });
  const standardSubtotalMinor = toMinor(standard.standardSubtotal);
  const finalQuote = selectedPricing || standard;
  const merchandiseTotalMinor = toMinor(finalQuote.merchandiseTotal);
  const delivery = resolveReviewDeliveryFee({
    cart,
    requiredFields: input.requiredFields,
    deliveryPricing: input.deliveryPricing,
  });
  const selectedOffer = selectedPricing ? buildSelectedOffer(selectedPricing) : undefined;
  const recommendedOffer = buildRecommendedOffer({
    source: input,
    commercial: validation.commercialEvaluation,
  });
  if (
    !items ||
    standardSubtotalMinor === undefined ||
    merchandiseTotalMinor === undefined ||
    (selectedPricing && !selectedOffer) ||
    (delivery.configured && !delivery.fee) ||
    (delivery.fee && delivery.fee.currency !== standard.currency)
  ) {
    return { success: false, failureCode: "UNSAFE_MONEY_VALUE", warnings: [...validation.warnings] };
  }
  if (items.reduce((total, item) => total + item.lineTotalMinor, 0) !== standardSubtotalMinor) {
    return { success: false, failureCode: "UNSAFE_MONEY_VALUE", warnings: [...validation.warnings] };
  }

  const finalTotalMinor = merchandiseTotalMinor + (delivery.fee?.amountMinor || 0);
  const snapshot: ConfirmedOrderSnapshot = {
    schemaVersion: CONFIRMED_ORDER_SNAPSHOT_SCHEMA_VERSION,
    id: validation.snapshotId,
    sellerId: text(input.sellerId, 120),
    conversationScopeId: text(input.conversationScopeId, 160),
    confirmedAt: validation.confirmedAt,
    product: {
      productId: text(input.productContext.productId, 120),
      name: text(input.productContext.name, 200),
    },
    receiptContext: {
      storeName: text(input.receiptContext.storeName || "Boutique", 160),
      ...(input.receiptContext.paymentMethodLabel ? { paymentMethodLabel: text(input.receiptContext.paymentMethodLabel, 160) } : {}),
      ...(input.receiptContext.deliveryText ? { deliveryText: text(input.receiptContext.deliveryText, 240) } : {}),
    },
    items,
    completedUnits: items.reduce((total, item) => total + item.quantity, 0),
    targetUnits: cart.targetItemCount || 0,
    orderFields: validation.requirements.map((requirement) => ({
      key: text(requirement.key, 80),
      label: text(requirement.label || requirement.key, 120),
      value: typeof cart.orderLevelFields[requirement.key] === "string"
        ? text(cart.orderLevelFields[requirement.key] as string, 240)
        : cart.orderLevelFields[requirement.key],
    })),
    currency: text(standard.currency, 16),
    standardSubtotalMinor,
    standardSubtotal: fromMinor(standardSubtotalMinor),
    ...(selectedOffer ? { selectedOffer } : {}),
    ...(recommendedOffer ? { recommendedOffer } : {}),
    merchandiseTotalMinor,
    merchandiseTotal: fromMinor(merchandiseTotalMinor),
    ...(delivery.fee ? { deliveryFee: { ...delivery.fee } } : {}),
    finalTotalMinor,
    finalTotal: fromMinor(finalTotalMinor),
    commercialWarnings: [...validation.commercialEvaluation.warnings].map((warning) => text(warning, 160)),
  };

  return {
    success: true,
    snapshot: deepFreeze(snapshot),
    commercialEvaluation: validation.commercialEvaluation,
    warnings: [...validation.warnings],
  };
}
