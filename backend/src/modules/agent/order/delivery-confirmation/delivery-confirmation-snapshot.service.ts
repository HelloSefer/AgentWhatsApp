import type { RequiredOrderField } from "../../config/required-fields.types";
import { resolveCartFieldScope } from "../cart-state.service";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import type { CartDraft } from "../cart-state.types";
import { getCollectedDeliveryFields } from "./delivery-requirements.service";
import type {
  ConfirmedOrderPreview,
  DeliveryConfirmationPreviewState,
  DeliveryOrderFieldSnapshot,
  DeliveryRequirement,
  DeliveryReviewItemSnapshot,
  FinalOrderReview,
} from "./delivery-confirmation.types";
import {
  resolveReviewDeliveryFee,
  toMinorMoney,
} from "./delivery-review-pricing.service";
import type { ProductContext } from "../../config/product-context.types";
import type { DeliveryPricingConfig } from "../../config/seller-config.types";

export function cloneDeliveryCart(cart: CartDraft): CartDraft {
  return {
    ...cart,
    items: cart.items.map((item) => ({ ...item, selectedOptions: { ...item.selectedOptions } })),
    currentItemDraft: cart.currentItemDraft
      ? { ...cart.currentItemDraft, selectedOptions: { ...cart.currentItemDraft.selectedOptions } }
      : undefined,
    orderLevelFields: { ...cart.orderLevelFields },
  };
}

export function cloneDeliveryPreviewState(
  state: DeliveryConfirmationPreviewState,
): DeliveryConfirmationPreviewState {
  return { ...state };
}

export function cloneDeliveryCommercialEvaluation(
  value: CartCommercialEvaluation,
): CartCommercialEvaluation {
  const cloneQuote = (quote: NonNullable<CartCommercialEvaluation["standardPricing"]>) => ({
    ...quote,
    lines: quote.lines.map((line) => ({ ...line })),
  });
  return {
    ...value,
    ...(value.standardPricing ? { standardPricing: cloneQuote(value.standardPricing) } : {}),
    ...(value.selectedOffer
      ? { selectedOffer: { ...value.selectedOffer, ...(value.selectedOffer.pricing ? { pricing: cloneQuote(value.selectedOffer.pricing) } : {}) } }
      : {}),
    eligibleOffers: value.eligibleOffers.map((offer) => ({ ...offer, pricing: cloneQuote(offer.pricing) })),
    ...(value.recommendedOffer ? { recommendedOffer: { ...value.recommendedOffer, pricing: cloneQuote(value.recommendedOffer.pricing) } } : {}),
    cartIntegrityErrors: [...value.cartIntegrityErrors],
    warnings: [...value.warnings],
    failures: value.failures.map((failure) => ({ ...failure, ...(failure.paths ? { paths: [...failure.paths] } : {}) })),
  };
}

function cloneReviewItem(item: DeliveryReviewItemSnapshot): DeliveryReviewItemSnapshot {
  return { ...item, options: item.options.map((option) => ({ ...option })) };
}

export function cloneFinalOrderReview(review: FinalOrderReview): FinalOrderReview {
  return {
    ...review,
    items: review.items.map(cloneReviewItem),
    orderFields: review.orderFields.map((field) => ({ ...field })),
    ...(review.selectedOffer ? { selectedOffer: { ...review.selectedOffer } } : {}),
    ...(review.recommendedOffer ? { recommendedOffer: { ...review.recommendedOffer } } : {}),
    ...(review.deliveryFee ? { deliveryFee: { ...review.deliveryFee } } : {}),
    warnings: [...review.warnings],
  };
}

export function cloneConfirmedOrderPreview(preview: ConfirmedOrderPreview): ConfirmedOrderPreview {
  return {
    ...preview,
    items: preview.items.map(cloneReviewItem),
    orderFields: preview.orderFields.map((field) => ({ ...field })),
    ...(preview.selectedOffer ? { selectedOffer: { ...preview.selectedOffer } } : {}),
    ...(preview.deliveryFee ? { deliveryFee: { ...preview.deliveryFee } } : {}),
  };
}

export function completedDeliveryUnits(cart: CartDraft): number {
  return cart.items.reduce((total, item) => total + item.quantity, 0);
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function snapshotItems(input: {
  cart: CartDraft;
  fields: RequiredOrderField[];
  productContext: ProductContext;
  commercial: CartCommercialEvaluation;
}): DeliveryReviewItemSnapshot[] | undefined {
  const labels = new Map(
    input.fields.filter((field) => resolveCartFieldScope(field) === "ITEM")
      .map((field) => [normalizeKey(field.key), field.label || field.key]),
  );
  const lines = new Map(
    input.commercial.standardPricing?.lines.map((line) => [line.cartItemId, line]) || [],
  );
  const items: DeliveryReviewItemSnapshot[] = [];

  for (const item of input.cart.items) {
    const line = lines.get(item.id);
    if (!line || line.productId !== item.productId || line.quantity !== item.quantity) {
      return undefined;
    }
    const unitPriceMinor = toMinorMoney(line.unitPrice);
    const lineTotalMinor = toMinorMoney(line.standardLineTotal);
    if (
      unitPriceMinor === undefined ||
      lineTotalMinor === undefined ||
      unitPriceMinor * item.quantity !== lineTotalMinor
    ) return undefined;

    items.push({
      id: item.id,
      productId: item.productId,
      productName: input.productContext.name,
      quantity: item.quantity,
      options: Object.entries(item.selectedOptions).map(([key, value]) => ({
        key,
        label: labels.get(normalizeKey(key)) || key,
        value,
      })),
      unitPriceMinor,
      lineTotalMinor,
      unitPrice: unitPriceMinor / 100,
      lineTotal: lineTotalMinor / 100,
    });
  }

  return items;
}

function snapshotOrderFields(
  requirements: readonly DeliveryRequirement[],
  cart: CartDraft,
): DeliveryOrderFieldSnapshot[] {
  return getCollectedDeliveryFields(requirements, cart).map(({ requirement, value }) => ({
    key: requirement.key,
    label: requirement.label,
    value,
  }));
}

export function buildFinalOrderReview(input: {
  cart: CartDraft;
  requirements: readonly DeliveryRequirement[];
  requiredFields: RequiredOrderField[];
  productContext: ProductContext;
  commercial: CartCommercialEvaluation;
  deliveryPricing?: DeliveryPricingConfig;
}): FinalOrderReview | undefined {
  const standard = input.commercial.standardPricing;
  if (!standard) return undefined;
  const selectedPricing = input.commercial.selectedOffer?.pricing;
  const items = snapshotItems({
    cart: input.cart,
    fields: input.requiredFields,
    productContext: input.productContext,
    commercial: input.commercial,
  });
  const standardSubtotalMinor = toMinorMoney(standard.standardSubtotal);
  const merchandiseTotal = selectedPricing?.merchandiseTotal || standard.merchandiseTotal;
  const merchandiseTotalMinor = toMinorMoney(merchandiseTotal);
  const delivery = resolveReviewDeliveryFee({
    cart: input.cart,
    requiredFields: input.requiredFields,
    deliveryPricing: input.deliveryPricing,
  });
  if (!items || standardSubtotalMinor === undefined || merchandiseTotalMinor === undefined) {
    return undefined;
  }
  if (delivery.configured && !delivery.fee) return undefined;
  if (delivery.fee && delivery.fee.currency !== standard.currency) return undefined;
  const finalTotalMinor = merchandiseTotalMinor + (delivery.fee?.amountMinor || 0);

  return {
    items,
    completedUnits: completedDeliveryUnits(input.cart),
    targetUnits: input.cart.targetItemCount || 0,
    orderFields: snapshotOrderFields(input.requirements, input.cart),
    standardSubtotalMinor,
    standardSubtotal: standardSubtotalMinor / 100,
    currency: standard.currency,
    ...(input.commercial.selectedOffer?.eligible && selectedPricing
      ? {
          selectedOffer: {
            offerId: input.commercial.selectedOffer.offerId,
            ...(selectedPricing.appliedOfferLabel ? { label: selectedPricing.appliedOfferLabel } : {}),
            totalMinor: merchandiseTotalMinor,
            total: merchandiseTotalMinor / 100,
            discountMinor: toMinorMoney(selectedPricing.discountAmount) || 0,
            discountAmount: (toMinorMoney(selectedPricing.discountAmount) || 0) / 100,
          },
        }
      : {}),
    ...(input.commercial.recommendedOffer
      ? {
          recommendedOffer: {
            offerId: input.commercial.recommendedOffer.offerId,
            ...(input.commercial.recommendedOffer.pricing.appliedOfferLabel
              ? { label: input.commercial.recommendedOffer.pricing.appliedOfferLabel }
              : {}),
            total: input.commercial.recommendedOffer.pricing.merchandiseTotal,
          },
        }
      : {}),
    merchandiseTotalMinor,
    merchandiseTotal: merchandiseTotalMinor / 100,
    ...(delivery.fee ? { deliveryFee: { ...delivery.fee } } : {}),
    finalTotalMinor,
    finalTotal: finalTotalMinor / 100,
    warnings: [...input.commercial.warnings],
    confirmationReady: true,
  };
}

export function buildConfirmedOrderPreview(input: {
  finalReview: FinalOrderReview;
  sellerId: string;
  conversationScopeId: string;
  confirmedAt: string;
}): ConfirmedOrderPreview {
  return {
    sellerId: input.sellerId,
    conversationScopeId: input.conversationScopeId,
    items: input.finalReview.items.map(cloneReviewItem),
    completedUnits: input.finalReview.completedUnits,
    orderFields: input.finalReview.orderFields.map((field) => ({ ...field })),
    standardSubtotalMinor: input.finalReview.standardSubtotalMinor,
    standardSubtotal: input.finalReview.standardSubtotal,
    currency: input.finalReview.currency,
    ...(input.finalReview.selectedOffer ? { selectedOffer: { ...input.finalReview.selectedOffer } } : {}),
    merchandiseTotalMinor: input.finalReview.merchandiseTotalMinor,
    merchandiseTotal: input.finalReview.merchandiseTotal,
    ...(input.finalReview.deliveryFee ? { deliveryFee: { ...input.finalReview.deliveryFee } } : {}),
    finalTotalMinor: input.finalReview.finalTotalMinor,
    finalTotal: input.finalReview.finalTotal,
    confirmedAt: input.confirmedAt,
  };
}
