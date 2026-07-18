import type { ProductOfferConfig } from "../../config/offers/offer.types";
import {
  MAX_CART_TARGET_ITEM_COUNT,
  clearCartPlanning,
  setCartPlanning,
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
