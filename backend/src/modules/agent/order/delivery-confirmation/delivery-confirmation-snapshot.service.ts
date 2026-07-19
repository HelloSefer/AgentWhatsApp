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
    warnings: [...review.warnings],
  };
}

export function cloneConfirmedOrderPreview(preview: ConfirmedOrderPreview): ConfirmedOrderPreview {
  return {
    ...preview,
    items: preview.items.map(cloneReviewItem),
    orderFields: preview.orderFields.map((field) => ({ ...field })),
    ...(preview.selectedOffer ? { selectedOffer: { ...preview.selectedOffer } } : {}),
  };
}

export function completedDeliveryUnits(cart: CartDraft): number {
  return cart.items.reduce((total, item) => total + item.quantity, 0);
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function snapshotItems(cart: CartDraft, fields: RequiredOrderField[]): DeliveryReviewItemSnapshot[] {
  const labels = new Map(
    fields.filter((field) => resolveCartFieldScope(field) === "ITEM")
      .map((field) => [normalizeKey(field.key), field.label || field.key]),
  );
  return cart.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    options: Object.entries(item.selectedOptions).map(([key, value]) => ({
      key,
      label: labels.get(normalizeKey(key)) || key,
      value,
    })),
  }));
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
  commercial: CartCommercialEvaluation;
}): FinalOrderReview | undefined {
  const standard = input.commercial.standardPricing;
  if (!standard) return undefined;
  const selectedPricing = input.commercial.selectedOffer?.pricing;
  return {
    items: snapshotItems(input.cart, input.requiredFields),
    completedUnits: completedDeliveryUnits(input.cart),
    targetUnits: input.cart.targetItemCount || 0,
    orderFields: snapshotOrderFields(input.requirements, input.cart),
    standardSubtotal: standard.standardSubtotal,
    currency: standard.currency,
    ...(input.commercial.selectedOffer?.eligible && selectedPricing
      ? { selectedOffer: { offerId: input.commercial.selectedOffer.offerId, total: selectedPricing.merchandiseTotal } }
      : {}),
    ...(input.commercial.recommendedOffer
      ? { recommendedOffer: { offerId: input.commercial.recommendedOffer.offerId, total: input.commercial.recommendedOffer.pricing.merchandiseTotal } }
      : {}),
    finalTotal: selectedPricing?.merchandiseTotal || standard.merchandiseTotal,
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
    standardSubtotal: input.finalReview.standardSubtotal,
    currency: input.finalReview.currency,
    ...(input.finalReview.selectedOffer ? { selectedOffer: { ...input.finalReview.selectedOffer } } : {}),
    finalTotal: input.finalReview.finalTotal,
    confirmedAt: input.confirmedAt,
  };
}
