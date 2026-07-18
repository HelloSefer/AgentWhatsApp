import {
  MAX_CART_TARGET_ITEM_COUNT,
  evaluateCartIntegrity,
  removeItem,
  resolveCartFieldScope,
  setCartStatus,
  updateItem,
} from "../cart-state.service";
import type { CartDraft } from "../cart-state.types";
import { evaluateCartCommercialState } from "../commercial/cart-commercial-evaluation.service";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import {
  acceptStandardAfterOfferLoss,
  incrementReviewTarget,
  synchronizeReviewTargetToCompletedUnits,
} from "../planning/cart-planning.service";
import type {
  CartReviewContext,
  CartReviewItemSnapshot,
  CartReviewMutationResult,
  CartReviewReadiness,
  CartReviewSnapshot,
} from "./cart-review.types";

function cloneCart(cart: CartDraft): CartDraft {
  return {
    ...cart,
    items: cart.items.map((item) => ({ ...item, selectedOptions: { ...item.selectedOptions } })),
    currentItemDraft: cart.currentItemDraft
      ? { ...cart.currentItemDraft, selectedOptions: { ...cart.currentItemDraft.selectedOptions } }
      : undefined,
    orderLevelFields: { ...cart.orderLevelFields },
  };
}

function cloneCommercialEvaluation(value: CartCommercialEvaluation): CartCommercialEvaluation {
  const cloneQuote = (quote: NonNullable<CartCommercialEvaluation["standardPricing"]>) => ({
    ...quote,
    lines: quote.lines.map((line) => ({ ...line })),
  });
  return {
    ...value,
    ...(value.standardPricing ? { standardPricing: cloneQuote(value.standardPricing) } : {}),
    ...(value.selectedOffer
      ? {
          selectedOffer: {
            ...value.selectedOffer,
            ...(value.selectedOffer.pricing ? { pricing: cloneQuote(value.selectedOffer.pricing) } : {}),
          },
        }
      : {}),
    eligibleOffers: value.eligibleOffers.map((offer) => ({
      ...offer,
      pricing: cloneQuote(offer.pricing),
    })),
    ...(value.recommendedOffer
      ? { recommendedOffer: { ...value.recommendedOffer, pricing: cloneQuote(value.recommendedOffer.pricing) } }
      : {}),
    cartIntegrityErrors: [...value.cartIntegrityErrors],
    warnings: [...value.warnings],
    failures: value.failures.map((failure) => ({ ...failure, ...(failure.paths ? { paths: [...failure.paths] } : {}) })),
  };
}

function completedUnits(cart: CartDraft): number {
  return cart.items.reduce((total, item) => total + item.quantity, 0);
}

function normalizeFieldKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function contextFor(input: CartReviewContext, cart: CartDraft): CartReviewContext {
  return { ...input, cart };
}

function isPositiveTarget(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_CART_TARGET_ITEM_COUNT;
}

function isProductScopeMatch(input: CartReviewContext): boolean {
  return (
    Boolean(input.sellerId.trim()) &&
    input.sellerId.trim() === input.productContext.sellerId.trim() &&
    Boolean(input.productContext.productId.trim()) &&
    input.cart.items.every((item) => item.productId === input.productContext.productId)
  );
}

function snapshotItems(input: CartReviewContext): CartReviewItemSnapshot[] {
  const fields = new Map(
    input.requiredFields
      .filter((field) => resolveCartFieldScope(field) === "ITEM")
      .map((field) => [normalizeFieldKey(field.key), field]),
  );

  return input.cart.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    options: Object.entries(item.selectedOptions)
      .map(([key, value]) => {
        const field = fields.get(normalizeFieldKey(key));
        return field ? { key: field.key, label: field.label || field.key, value } : undefined;
      })
      .filter((option): option is NonNullable<typeof option> => Boolean(option)),
  }));
}

export function buildCartReviewSnapshot(input: {
  context: CartReviewContext;
  commercialEvaluation: CartCommercialEvaluation;
  warnings?: string[];
}): CartReviewSnapshot {
  const commercial = input.commercialEvaluation;
  return {
    items: snapshotItems(input.context),
    completedUnits: completedUnits(input.context.cart),
    cartLineCount: input.context.cart.items.length,
    targetUnits: input.context.cart.targetItemCount || 0,
    ...(input.context.cart.selectedOfferId ? { selectedOfferId: input.context.cart.selectedOfferId } : {}),
    ...(commercial.standardPricing ? { standardSubtotal: commercial.standardPricing.standardSubtotal } : {}),
    ...(commercial.selectedOffer?.pricing ? { selectedOfferTotal: commercial.selectedOffer.pricing.merchandiseTotal } : {}),
    ...(commercial.recommendedOffer
      ? { recommendedOffer: { offerId: commercial.recommendedOffer.offerId, total: commercial.recommendedOffer.pricing.merchandiseTotal } }
      : {}),
    warnings: [...(input.warnings || []), ...commercial.warnings],
  };
}

/** Read-only gate for the deterministic, completed-cart review surface. */
export function inspectCartReviewReadiness(input: CartReviewContext): CartReviewReadiness {
  if (!isProductScopeMatch(input)) {
    return { ready: false, failureCode: "PRODUCT_MISMATCH", warnings: [] };
  }

  const integrity = evaluateCartIntegrity({ cart: input.cart, fields: input.requiredFields });
  if (!integrity.valid) {
    return { ready: false, failureCode: "INVALID_CART", warnings: [...integrity.warnings] };
  }

  if (input.cart.status !== "CART_REVIEW") {
    return { ready: false, failureCode: "INVALID_REVIEW_STATE", warnings: [] };
  }
  if (input.cart.currentItemDraft) {
    return { ready: false, failureCode: "CURRENT_ITEM_PRESENT", warnings: [] };
  }
  if (!input.cart.items.length) {
    return { ready: false, failureCode: "EMPTY_CART", warnings: [] };
  }
  if (!isPositiveTarget(input.cart.targetItemCount)) {
    return { ready: false, failureCode: "INVALID_TARGET_ITEM_COUNT", warnings: [] };
  }

  const units = completedUnits(input.cart);
  if (!Number.isSafeInteger(units) || units > input.cart.targetItemCount) {
    return { ready: false, failureCode: "TARGET_OVERFILLED", warnings: [] };
  }
  if (units !== input.cart.targetItemCount) {
    return { ready: false, failureCode: "TARGET_NOT_FULFILLED", warnings: [] };
  }

  const commercialEvaluation = evaluateCartCommercialState({
    sellerId: input.sellerId,
    productContext: input.productContext,
    fields: input.requiredFields,
    offerLookup: input.offerLookup,
    cart: input.cart,
    now: input.now,
  });
  if (!commercialEvaluation.cartValid || !commercialEvaluation.standardPricing) {
    return {
      ready: false,
      failureCode: "COMMERCIAL_STATE_BLOCKED",
      commercialEvaluation: cloneCommercialEvaluation(commercialEvaluation),
      warnings: [...commercialEvaluation.warnings],
    };
  }

  const review = buildCartReviewSnapshot({ context: input, commercialEvaluation });
  return {
    ready: true,
    review,
    commercialEvaluation: cloneCommercialEvaluation(commercialEvaluation),
    warnings: [...review.warnings],
  };
}

function mutationResult(input: {
  success: boolean;
  changed: boolean;
  context: CartReviewContext;
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
  planningResult?: CartReviewMutationResult["planningResult"];
  failureCode?: CartReviewMutationResult["failureCode"];
  warnings?: string[];
}): CartReviewMutationResult {
  const cartAfter = input.cartAfter || input.cartBefore;
  const readiness = input.success
    ? inspectCartReviewReadiness(contextFor(input.context, cartAfter))
    : undefined;
  return {
    success: input.success && Boolean(readiness?.ready),
    changed: input.changed,
    cartBefore: cloneCart(input.cartBefore),
    cartAfter: cloneCart(cartAfter),
    ...(readiness?.review ? { review: readiness.review } : {}),
    ...(readiness?.commercialEvaluation ? { commercialEvaluation: readiness.commercialEvaluation } : {}),
    ...(input.planningResult ? { planningResult: input.planningResult } : {}),
    ...(input.failureCode || readiness?.failureCode ? { failureCode: input.failureCode || readiness?.failureCode } : {}),
    warnings: [...(input.warnings || []), ...(readiness?.warnings || [])],
  };
}

function synchronizeAfterCompletedItemMutation(input: {
  context: CartReviewContext;
  cartBefore: CartDraft;
  cartAfterMutation: CartDraft;
  changed: boolean;
  warnings?: string[];
}): CartReviewMutationResult {
  const lifecycle = setCartStatus({ cart: input.cartAfterMutation, status: "CART_REVIEW" });
  if (!lifecycle.accepted) {
    return mutationResult({
      success: false,
      changed: false,
      context: input.context,
      cartBefore: input.cartBefore,
      cartAfter: input.cartBefore,
      failureCode: "CART_MUTATION_REJECTED",
      warnings: input.warnings,
    });
  }
  const planningResult = synchronizeReviewTargetToCompletedUnits(
    contextFor(input.context, lifecycle.cart),
  );
  if (!planningResult.success) {
    return mutationResult({
      success: false,
      changed: false,
      context: input.context,
      cartBefore: input.cartBefore,
      cartAfter: input.cartBefore,
      planningResult,
      failureCode: "PLANNING_COMMAND_REJECTED",
      warnings: [...(input.warnings || []), ...planningResult.warnings],
    });
  }
  return mutationResult({
    success: true,
    changed: input.changed || planningResult.changed,
    context: input.context,
    cartBefore: input.cartBefore,
    cartAfter: planningResult.cart,
    planningResult,
    warnings: [...(input.warnings || []), ...planningResult.warnings],
  });
}

/** Replaces only one trusted completed line quantity and re-evaluates review state. */
export function replaceCartReviewItemQuantity(input: {
  context: CartReviewContext;
  itemId: string;
  quantity: number;
}): CartReviewMutationResult {
  const cartBefore = cloneCart(input.context.cart);
  const readiness = inspectCartReviewReadiness(input.context);
  if (!readiness.ready) {
    return mutationResult({ success: false, changed: false, context: input.context, cartBefore, failureCode: readiness.failureCode, warnings: readiness.warnings });
  }
  const item = cartBefore.items.find((candidate) => candidate.id === input.itemId);
  if (!item) {
    return mutationResult({ success: false, changed: false, context: input.context, cartBefore, failureCode: "UNKNOWN_CART_ITEM" });
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > MAX_CART_TARGET_ITEM_COUNT) {
    return mutationResult({ success: false, changed: false, context: input.context, cartBefore, failureCode: "INVALID_QUANTITY" });
  }

  const mutation = updateItem({ cart: cartBefore, itemId: input.itemId, quantity: input.quantity });
  if (!mutation.accepted) {
    return mutationResult({ success: false, changed: false, context: input.context, cartBefore, failureCode: mutation.invalidPaths?.includes("itemId") ? "UNKNOWN_CART_ITEM" : "CART_MUTATION_REJECTED" });
  }
  return synchronizeAfterCompletedItemMutation({
    context: input.context,
    cartBefore,
    cartAfterMutation: mutation.cart,
    changed: item.quantity !== input.quantity,
  });
}

/** Removes one completed line but never turns review into an empty cancellation. */
export function removeCartReviewItem(input: {
  context: CartReviewContext;
  itemId: string;
}): CartReviewMutationResult {
  const cartBefore = cloneCart(input.context.cart);
  const readiness = inspectCartReviewReadiness(input.context);
  if (!readiness.ready) {
    return mutationResult({ success: false, changed: false, context: input.context, cartBefore, failureCode: readiness.failureCode, warnings: readiness.warnings });
  }
  if (!cartBefore.items.some((item) => item.id === input.itemId)) {
    return mutationResult({ success: false, changed: false, context: input.context, cartBefore, failureCode: "UNKNOWN_CART_ITEM" });
  }
  if (cartBefore.items.length <= 1) {
    return mutationResult({ success: false, changed: false, context: input.context, cartBefore, failureCode: "LAST_ITEM_REMOVAL_NOT_ALLOWED" });
  }

  const mutation = removeItem({ cart: cartBefore, itemId: input.itemId });
  if (!mutation.accepted) {
    return mutationResult({ success: false, changed: false, context: input.context, cartBefore, failureCode: "UNKNOWN_CART_ITEM" });
  }
  return synchronizeAfterCompletedItemMutation({
    context: input.context,
    cartBefore,
    cartAfterMutation: mutation.cart,
    changed: true,
  });
}

/** Increments only the trusted review target. D1 starts the actual draft later. */
export function incrementCartReviewTarget(
  context: CartReviewContext,
): CartReviewMutationResult {
  const cartBefore = cloneCart(context.cart);
  const readiness = inspectCartReviewReadiness(context);
  if (!readiness.ready) {
    return mutationResult({ success: false, changed: false, context, cartBefore, failureCode: readiness.failureCode, warnings: readiness.warnings });
  }
  const planningResult = incrementReviewTarget(context);
  if (!planningResult.success) {
    return mutationResult({ success: false, changed: false, context, cartBefore, planningResult, failureCode: "PLANNING_COMMAND_REJECTED", warnings: planningResult.warnings });
  }
  return {
    success: true,
    changed: planningResult.changed,
    cartBefore,
    cartAfter: cloneCart(planningResult.cart),
    planningResult,
    warnings: [...planningResult.warnings],
  };
}

/** Explicitly abandons only an ineligible selected offer, preserving cart lines. */
export function useStandardAfterOfferLoss(
  context: CartReviewContext,
): CartReviewMutationResult {
  const cartBefore = cloneCart(context.cart);
  const readiness = inspectCartReviewReadiness(context);
  if (!readiness.ready) {
    return mutationResult({ success: false, changed: false, context, cartBefore, failureCode: readiness.failureCode, warnings: readiness.warnings });
  }
  const selectedOfferIneligible = readiness.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE";
  const planningResult = acceptStandardAfterOfferLoss(context, selectedOfferIneligible);
  if (!planningResult.success) {
    return mutationResult({ success: false, changed: false, context, cartBefore, planningResult, failureCode: planningResult.failureCode === "SELECTED_OFFER_NOT_INELIGIBLE" ? "SELECTED_OFFER_NOT_INELIGIBLE" : "PLANNING_COMMAND_REJECTED", warnings: planningResult.warnings });
  }
  return mutationResult({
    success: true,
    changed: planningResult.changed,
    context,
    cartBefore,
    cartAfter: planningResult.cart,
    planningResult,
    warnings: planningResult.warnings,
  });
}
