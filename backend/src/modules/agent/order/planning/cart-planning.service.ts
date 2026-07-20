import type { ProductOfferConfig } from "../../config/offers/offer.types";
import {
  MAX_CART_TARGET_ITEM_COUNT,
  clearCartPlanning,
  setCartPlanning,
  setCartStatus,
} from "../cart-state.service";
import type { CartDraft } from "../cart-state.types";
import type {
  CartPlanningCommand,
  CartPlanningContext,
  CartPlanningFailureCode,
  CartPlanningReadiness,
  CartPlanningResult,
} from "./cart-planning.types";

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

function samePlanningState(left: CartDraft, right: CartDraft): boolean {
  return (
    left.mode === right.mode &&
    left.status === right.status &&
    left.targetItemCount === right.targetItemCount &&
    left.initialCollectionMode === right.initialCollectionMode &&
    left.selectedOfferId === right.selectedOfferId
  );
}

function failure(
  context: CartPlanningContext,
  command: CartPlanningCommand,
  failureCode: CartPlanningFailureCode,
  warnings: string[] = [],
): CartPlanningResult {
  return {
    success: false,
    command,
    cart: cloneCart(context.cart),
    changed: false,
    failureCode,
    warnings,
  };
}

function hasUnresolvedCurrentItem(cart: CartDraft): boolean {
  const draft = cart.currentItemDraft;
  if (!draft) {
    return false;
  }

  return draft.quantityExplicitlySet === true || Object.keys(draft.selectedOptions).length > 0;
}

function hasValidNow(now: Date): boolean {
  return Number.isFinite(now.getTime());
}

function completedUnits(cart: CartDraft): number {
  return cart.items.reduce((total, item) => total + item.quantity, 0);
}

function validateOfferAvailability(
  offer: ProductOfferConfig,
  now: Date,
): CartPlanningFailureCode | undefined {
  if (!offer.active) {
    return "OFFER_INACTIVE";
  }

  if (offer.startsAt && now.getTime() < new Date(offer.startsAt).getTime()) {
    return "OFFER_NOT_STARTED";
  }

  if (offer.endsAt && now.getTime() >= new Date(offer.endsAt).getTime()) {
    return "OFFER_EXPIRED";
  }

  return undefined;
}

function applyStandardPlanning(
  context: CartPlanningContext,
  command: CartPlanningCommand,
  targetItemCount: unknown,
): CartPlanningResult {
  const readiness = inspectCartPlanningReadiness(context);
  if (!readiness.ready) {
    return failure(context, command, readiness.failureCode!, readiness.warnings);
  }

  if (
    typeof targetItemCount !== "number" ||
    !Number.isFinite(targetItemCount) ||
    !Number.isInteger(targetItemCount) ||
    targetItemCount <= 0 ||
    targetItemCount > MAX_CART_TARGET_ITEM_COUNT
  ) {
    return failure(context, command, "INVALID_QUANTITY");
  }

  const mutation = setCartPlanning({
    cart: context.cart,
    mode: "STANDARD",
    targetItemCount,
    initialCollectionMode: "IMPLICIT_PLANNED_PIECE_SLOTS",
  });
  if (!mutation.accepted) {
    return failure(context, command, "INVALID_QUANTITY");
  }

  return {
    success: true,
    command,
    cart: mutation.cart,
    changed: !samePlanningState(context.cart, mutation.cart),
    warnings: [],
  };
}

function applyOfferSelection(
  context: CartPlanningContext,
  command: CartPlanningCommand,
  offerId: string,
): CartPlanningResult {
  const readiness = inspectCartPlanningReadiness(context);
  if (!readiness.ready) {
    return failure(context, command, readiness.failureCode!, readiness.warnings);
  }

  if (!hasValidNow(context.now)) {
    return failure(context, command, "INVALID_EVALUATION_TIME");
  }

  const sellerId = context.sellerId.trim();
  const productId = context.productContext.productId?.trim();
  if (
    !sellerId ||
    !productId ||
    context.offerLookup.sellerId !== sellerId ||
    context.offerLookup.productId !== productId
  ) {
    return failure(context, command, "PRODUCT_MISMATCH");
  }

  if (context.offerLookup.state === "PRODUCT_NOT_FOUND") {
    return failure(context, command, "PRODUCT_MISMATCH");
  }

  if (context.offerLookup.state === "INVALID_CONFIGURATION" || !context.offerLookup.validation.valid) {
    return failure(context, command, "INVALID_OFFER_CONFIG");
  }

  const normalizedOfferId = offerId.trim();
  const offer = context.offerLookup.offers.find((candidate) => candidate.id === normalizedOfferId);
  if (!offer) {
    return failure(context, command, "UNKNOWN_OFFER");
  }

  if (offer.productId !== productId) {
    return failure(context, command, "PRODUCT_MISMATCH");
  }

  const availabilityFailure = validateOfferAvailability(offer, context.now);
  if (availabilityFailure) {
    return failure(context, command, availabilityFailure);
  }

  const mutation = setCartPlanning({
    cart: context.cart,
    mode: "OFFER",
    targetItemCount: offer.requiredItemCount,
    selectedOfferId: offer.id,
    initialCollectionMode: "IMPLICIT_PLANNED_PIECE_SLOTS",
  });
  if (!mutation.accepted) {
    return failure(context, command, "INVALID_OFFER_CONFIG");
  }

  return {
    success: true,
    command,
    cart: mutation.cart,
    changed: !samePlanningState(context.cart, mutation.cart),
    warnings: [],
  };
}

/**
 * Planning is allowed only before completed item collection begins. Existing
 * items are intentionally preserved; callers must reset explicitly to change
 * the commercial plan after collection.
 */
export function inspectCartPlanningReadiness(context: CartPlanningContext): CartPlanningReadiness {
  if (context.cart.status === "CONFIRMED") {
    return { ready: false, failureCode: "CART_ALREADY_CONFIRMED", warnings: [] };
  }

  if (context.cart.items.length > 0) {
    return {
      ready: false,
      failureCode: "EXISTING_ITEMS_REQUIRE_RESET",
      warnings: ["Existing completed cart items are preserved and require an explicit reset."],
    };
  }

  if (context.cart.status === "COLLECTING_ITEM" && hasUnresolvedCurrentItem(context.cart)) {
    return { ready: false, failureCode: "UNRESOLVED_CURRENT_ITEM", warnings: [] };
  }

  if (!["EMPTY", "PLANNING", "COLLECTING_ITEM"].includes(context.cart.status)) {
    return { ready: false, failureCode: "INVALID_CART_STATE", warnings: [] };
  }

  return { ready: true, warnings: [] };
}

export function initializeStandardCartPlanning(context: CartPlanningContext): CartPlanningResult {
  return applyStandardPlanning(context, "INITIALIZE_STANDARD_PLANNING", 1);
}

export function selectStandardTargetQuantity(
  context: CartPlanningContext,
  targetItemCount: unknown,
): CartPlanningResult {
  return applyStandardPlanning(context, "SELECT_STANDARD_QUANTITY", targetItemCount);
}

export function initializeOfferCartPlanning(
  context: CartPlanningContext,
  offerId: string,
): CartPlanningResult {
  return applyOfferSelection(context, "INITIALIZE_OFFER_PLANNING", offerId);
}

export function selectConfiguredOffer(
  context: CartPlanningContext,
  offerId: string,
): CartPlanningResult {
  return applyOfferSelection(context, "SELECT_OFFER", offerId);
}

export function clearPlanning(context: CartPlanningContext): CartPlanningResult {
  const readiness = inspectCartPlanningReadiness(context);
  if (!readiness.ready) {
    return failure(context, "CLEAR_PLANNING", readiness.failureCode!, readiness.warnings);
  }

  const mutation = clearCartPlanning({ cart: context.cart });
  return {
    success: mutation.accepted,
    command: "CLEAR_PLANNING",
    cart: mutation.cart,
    changed: !samePlanningState(context.cart, mutation.cart),
    warnings: [],
  };
}

/** Review-target commands are intentionally separate from first-entry planning. */
export function inspectCartReviewPlanningReadiness(
  context: CartPlanningContext,
): CartPlanningReadiness {
  if (context.cart.status === "CONFIRMED") {
    return { ready: false, failureCode: "CART_ALREADY_CONFIRMED", warnings: [] };
  }

  if (context.sellerId.trim() !== context.productContext.sellerId.trim()) {
    return { ready: false, failureCode: "PRODUCT_MISMATCH", warnings: [] };
  }

  if (context.cart.status !== "CART_REVIEW" || context.cart.currentItemDraft) {
    return { ready: false, failureCode: "INVALID_REVIEW_STATE", warnings: [] };
  }

  if (!context.cart.items.length) {
    return { ready: false, failureCode: "EMPTY_REVIEW_CART", warnings: [] };
  }

  if (context.cart.items.some((item) => item.productId !== context.productContext.productId)) {
    return { ready: false, failureCode: "PRODUCT_MISMATCH", warnings: [] };
  }

  const units = completedUnits(context.cart);
  if (!Number.isSafeInteger(units) || units <= 0 || units > MAX_CART_TARGET_ITEM_COUNT) {
    return { ready: false, failureCode: "INVALID_QUANTITY", warnings: [] };
  }

  return { ready: true, warnings: [] };
}

function applyReviewPlanning(input: {
  context: CartPlanningContext;
  command: CartPlanningCommand;
  targetItemCount: number;
  mode: CartDraft["mode"];
  selectedOfferId?: string;
  status: CartDraft["status"];
}): CartPlanningResult {
  const readiness = inspectCartReviewPlanningReadiness(input.context);
  if (!readiness.ready) {
    return failure(input.context, input.command, readiness.failureCode!, readiness.warnings);
  }

  const planning = setCartPlanning({
    cart: input.context.cart,
    mode: input.mode,
    targetItemCount: input.targetItemCount,
    ...(input.selectedOfferId ? { selectedOfferId: input.selectedOfferId } : {}),
    initialCollectionMode: null,
  });
  if (!planning.accepted) {
    return failure(input.context, input.command, "INVALID_QUANTITY");
  }

  const lifecycle = setCartStatus({ cart: planning.cart, status: input.status });
  if (!lifecycle.accepted) {
    return failure(input.context, input.command, "INVALID_REVIEW_STATE");
  }

  return {
    success: true,
    command: input.command,
    cart: lifecycle.cart,
    changed: !samePlanningState(input.context.cart, lifecycle.cart),
    warnings: [],
  };
}

/** Aligns the review target with completed units after a scoped item mutation. */
export function synchronizeReviewTargetToCompletedUnits(
  context: CartPlanningContext,
): CartPlanningResult {
  return applyReviewPlanning({
    context,
    command: "SYNCHRONIZE_REVIEW_TARGET",
    targetItemCount: completedUnits(context.cart),
    mode: context.cart.mode,
    ...(context.cart.selectedOfferId ? { selectedOfferId: context.cart.selectedOfferId } : {}),
    status: "CART_REVIEW",
  });
}

/** Adds exactly one planned unit, then leaves D1 responsible for the new draft. */
export function incrementReviewTarget(
  context: CartPlanningContext,
): CartPlanningResult {
  const units = completedUnits(context.cart);
  return applyReviewPlanning({
    context,
    command: "INCREMENT_REVIEW_TARGET",
    targetItemCount: units + 1,
    mode: context.cart.mode,
    ...(context.cart.selectedOfferId ? { selectedOfferId: context.cart.selectedOfferId } : {}),
    status: "PLANNING",
  });
}

/** Requires the caller's fresh commercial evaluation before leaving a lost offer. */
export function acceptStandardAfterOfferLoss(
  context: CartPlanningContext,
  selectedOfferIneligible: boolean,
): CartPlanningResult {
  const readiness = inspectCartReviewPlanningReadiness(context);
  if (!readiness.ready) {
    return failure(context, "ACCEPT_STANDARD_AFTER_OFFER_LOSS", readiness.failureCode!, readiness.warnings);
  }

  if (context.cart.mode === "STANDARD" && !context.cart.selectedOfferId) {
    return {
      success: true,
      command: "ACCEPT_STANDARD_AFTER_OFFER_LOSS",
      cart: cloneCart(context.cart),
      changed: false,
      warnings: [],
    };
  }

  if (!context.cart.selectedOfferId || !selectedOfferIneligible) {
    return failure(context, "ACCEPT_STANDARD_AFTER_OFFER_LOSS", "SELECTED_OFFER_NOT_INELIGIBLE");
  }

  return applyReviewPlanning({
    context,
    command: "ACCEPT_STANDARD_AFTER_OFFER_LOSS",
    targetItemCount: completedUnits(context.cart),
    mode: "STANDARD",
    status: "CART_REVIEW",
  });
}
