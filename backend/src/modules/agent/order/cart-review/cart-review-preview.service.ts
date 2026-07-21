import { initializeCart } from "../cart-state.service";
import type { CartDraft } from "../cart-state.types";
import { runItemCollectionPreview } from "../item-collection/preview/item-collection-preview.service";
import { normalizeCartCustomQuantityInput } from "../planning/quantity/cart-quantity-input-normalizer.service";
import { normalizeCartReviewAction } from "./cart-review-action.service";
import { runCartItemEditPreview } from "./item-edit/cart-item-edit-preview.service";
import type { CartItemEditPreviewState } from "./item-edit/cart-item-edit.types";
import {
  buildCartReviewItemActionsPresentation,
  buildCartReviewItemSelectorPresentation,
  buildCartReviewPresentation,
  buildCartReviewQuantityInputPresentation,
  buildCommercialResolutionPresentation,
} from "./cart-review-presentation.service";
import {
  incrementCartReviewTarget,
  inspectCartReviewReadiness,
  removeCartReviewItem,
  replaceCartReviewItemQuantity,
  useStandardAfterOfferLoss,
} from "./cart-review.service";
import {
  CART_REVIEW_PREVIEW_STATE_VERSION,
  type CartReviewPreviewInput,
  type CartReviewPreviewResult,
  type CartReviewPreviewState,
  type CartReviewPresentationResult,
  type CartReviewSnapshot,
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

function cloneState(state: CartReviewPreviewState): CartReviewPreviewState {
  return {
    version: CART_REVIEW_PREVIEW_STATE_VERSION,
    awaitingInput: state.awaitingInput.kind === "EDIT_CART_ITEM_QUANTITY"
      ? { kind: "EDIT_CART_ITEM_QUANTITY", itemId: state.awaitingInput.itemId }
      : { kind: "NONE" },
    ...(state.selectedItemId ? { selectedItemId: state.selectedItemId } : {}),
    ...(state.standardAccepted ? { standardAccepted: true } : {}),
  };
}

function cloneItemEditState(state: CartItemEditPreviewState): CartItemEditPreviewState {
  return {
    ...state,
    workingItem: { ...state.workingItem, selectedOptions: { ...state.workingItem.selectedOptions } },
  };
}

function cloneReview(review: CartReviewSnapshot): CartReviewSnapshot {
  return {
    ...review,
    items: review.items.map((item) => ({
      ...item,
      options: item.options.map((option) => ({ ...option })),
    })),
    ...(review.recommendedOffer ? { recommendedOffer: { ...review.recommendedOffer } } : {}),
    warnings: [...review.warnings],
  };
}

function clonePresentation(
  presentation: CartReviewPresentationResult,
): CartReviewPresentationResult {
  return {
    ...presentation,
    ...(presentation.uiHints
      ? {
          uiHints: {
            ...presentation.uiHints,
            options: presentation.uiHints.options?.map((option) => ({ ...option })),
          },
        }
      : {}),
    warnings: [...presentation.warnings],
  };
}

function normalizePreviewState(
  state: CartReviewPreviewState | undefined,
  cart: CartDraft,
): CartReviewPreviewState {
  const empty: CartReviewPreviewState = {
    version: CART_REVIEW_PREVIEW_STATE_VERSION,
    awaitingInput: { kind: "NONE" },
  };
  if (state?.version !== CART_REVIEW_PREVIEW_STATE_VERSION) {
    return empty;
  }

  const selectedItemId = state.selectedItemId && cart.items.some((item) => item.id === state.selectedItemId)
    ? state.selectedItemId
    : undefined;
  const awaiting = state.awaitingInput;
  const awaitingInput = awaiting.kind === "EDIT_CART_ITEM_QUANTITY" &&
    cart.items.some((item) => item.id === awaiting.itemId)
    ? { kind: "EDIT_CART_ITEM_QUANTITY" as const, itemId: awaiting.itemId }
    : { kind: "NONE" as const };
  return {
    version: CART_REVIEW_PREVIEW_STATE_VERSION,
    awaitingInput,
    ...(selectedItemId ? { selectedItemId } : {}),
    ...(state.standardAccepted === true ? { standardAccepted: true } : {}),
  };
}

function contextFor(input: CartReviewPreviewInput, cart: CartDraft) {
  return {
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
    offerLookup: input.offerLookup,
    cart,
    now: input.now,
  };
}

function mainPresentation(input: {
  review: CartReviewSnapshot;
  commercialState?: string;
  conversationalProductName?: string;
}): CartReviewPresentationResult {
  return input.commercialState === "SELECTED_OFFER_INELIGIBLE"
    ? buildCommercialResolutionPresentation()
    : buildCartReviewPresentation(input.review, input.conversationalProductName);
}

function result(input: {
  handled: boolean;
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
  review?: CartReviewPreviewResult["review"];
  presentation?: CartReviewPreviewResult["presentation"];
  commercialEvaluation?: CartReviewPreviewResult["commercialEvaluation"];
  previewState: CartReviewPreviewState;
  itemCollectionPreview?: CartReviewPreviewResult["itemCollectionPreview"];
  planningResult?: CartReviewPreviewResult["planningResult"];
  quantityResult?: CartReviewPreviewResult["quantityResult"];
  cartItemEditPreview?: CartReviewPreviewResult["cartItemEditPreview"];
  cartItemEditPreviewState?: CartReviewPreviewResult["cartItemEditPreviewState"];
  normalizedAction?: CartReviewPreviewResult["normalizedAction"];
  nextStep?: CartReviewPreviewResult["nextStep"];
  failureCode?: CartReviewPreviewResult["failureCode"];
  warnings?: string[];
}): CartReviewPreviewResult {
  return {
    handled: input.handled,
    success: input.success,
    changed: input.changed,
    cartBefore: cloneCart(input.cartBefore),
    cartAfter: cloneCart(input.cartAfter || input.cartBefore),
    ...(input.review ? { review: cloneReview(input.review) } : {}),
    ...(input.presentation ? { presentation: clonePresentation(input.presentation) } : {}),
    ...(input.commercialEvaluation ? { commercialEvaluation: input.commercialEvaluation } : {}),
    previewState: cloneState(input.previewState),
    ...(input.itemCollectionPreview ? { itemCollectionPreview: input.itemCollectionPreview } : {}),
    ...(input.planningResult ? { planningResult: input.planningResult } : {}),
    ...(input.quantityResult ? { quantityResult: { ...input.quantityResult } } : {}),
    ...(input.cartItemEditPreview ? { cartItemEditPreview: input.cartItemEditPreview } : {}),
    ...(input.cartItemEditPreviewState ? { cartItemEditPreviewState: cloneItemEditState(input.cartItemEditPreviewState) } : {}),
    ...(input.normalizedAction ? { normalizedAction: { ...input.normalizedAction } } : {}),
    ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    warnings: [...(input.warnings || [])],
  };
}

function blockedFromReadiness(input: {
  cartBefore: CartDraft;
  previewState: CartReviewPreviewState;
  readiness: ReturnType<typeof inspectCartReviewReadiness>;
  normalizedAction?: CartReviewPreviewResult["normalizedAction"];
}): CartReviewPreviewResult {
  return result({
    handled: true,
    success: false,
    changed: false,
    cartBefore: input.cartBefore,
    ...(input.readiness.review ? { review: input.readiness.review } : {}),
    ...(input.readiness.commercialEvaluation ? { commercialEvaluation: input.readiness.commercialEvaluation } : {}),
    previewState: input.previewState,
    ...(input.normalizedAction ? { normalizedAction: input.normalizedAction } : {}),
    nextStep: "BLOCKED",
    failureCode: input.readiness.failureCode,
    warnings: input.readiness.warnings,
  });
}

/** Explicit Preview-only cart-review orchestration. It never persists or dispatches. */
export function runCartReviewPreview(
  input: CartReviewPreviewInput,
): CartReviewPreviewResult {
  const cartBefore = cloneCart(input.cart || initializeCart());
  const previewState = normalizePreviewState(input.previewState, cartBefore);
  if (!input.previewEnabled) {
    return result({ handled: false, success: false, changed: false, cartBefore, previewState });
  }

  const initialReviewAction = typeof input.rawActionId === "string"
    ? normalizeCartReviewAction(input.rawActionId)
    : undefined;
  const itemEditStartItemId = initialReviewAction?.valid && initialReviewAction.action?.type === "EDIT_ITEM_OPTIONS"
    ? initialReviewAction.action.itemId
    : undefined;
  const isExplicitItemEditControl = typeof input.rawActionId === "string" && input.rawActionId.startsWith("cart_review_item_edit:");
  if (itemEditStartItemId || input.cartItemEditPreviewState !== undefined || isExplicitItemEditControl) {
    const itemEdit = runCartItemEditPreview({
      previewEnabled: true,
      rawActionId: input.rawActionId,
      cartReviewText: input.cartReviewText,
      editState: input.cartItemEditPreviewState,
      ...(itemEditStartItemId ? { startItemId: itemEditStartItemId } : {}),
      hasCartReviewConflict: previewState.awaitingInput.kind !== "NONE",
      sellerId: input.sellerId,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
      offerLookup: input.offerLookup,
      cart: cartBefore,
      now: input.now,
    });
    return result({
      handled: itemEdit.handled,
      success: itemEdit.success,
      changed: itemEdit.changed,
      cartBefore,
      cartAfter: itemEdit.cartAfter,
      ...(itemEdit.review ? { review: itemEdit.review } : {}),
      ...(itemEdit.presentation ? { presentation: itemEdit.presentation } : {}),
      ...(itemEdit.commercialEvaluation ? { commercialEvaluation: itemEdit.commercialEvaluation } : {}),
      previewState,
      ...(itemEdit.editState ? { cartItemEditPreviewState: itemEdit.editState } : {}),
      cartItemEditPreview: itemEdit,
      ...(itemEdit.planningResult ? { planningResult: itemEdit.planningResult } : {}),
      ...(initialReviewAction?.action ? { normalizedAction: initialReviewAction.action } : {}),
      nextStep: itemEdit.nextStep === "RETURN_TO_CART_REVIEW" || itemEdit.nextStep === "REVIEW_ITEM_CHANGES"
        ? "SHOW_CART_REVIEW"
        : itemEdit.nextStep === "ENTER_ITEM_OPTION_TEXT" || itemEdit.nextStep === "SELECT_ITEM_OPTION"
          ? "SHOW_ITEM_ACTIONS"
          : itemEdit.nextStep === "RESOLVE_COMMERCIAL_STATE"
            ? "RESOLVE_COMMERCIAL_STATE"
            : "BLOCKED",
      failureCode: itemEdit.failureCode,
      warnings: itemEdit.warnings,
    });
  }

  if (previewState.awaitingInput.kind === "EDIT_CART_ITEM_QUANTITY" && input.cartReviewText !== undefined) {
    const awaitingItemId = previewState.awaitingInput.itemId;
    const quantityResult = normalizeCartCustomQuantityInput(input.cartReviewText);
    if (!quantityResult.success || quantityResult.quantity === undefined) {
      const readiness = inspectCartReviewReadiness(contextFor(input, cartBefore));
      return result({
        handled: true,
        success: false,
        changed: false,
        cartBefore,
        ...(readiness.review ? { review: readiness.review } : {}),
        ...(readiness.commercialEvaluation ? { commercialEvaluation: readiness.commercialEvaluation } : {}),
        ...(readiness.review ? { presentation: buildCartReviewQuantityInputPresentation(readiness.review.items.find((item) => item.id === awaitingItemId)!) } : {}),
        previewState,
        quantityResult,
        nextStep: "ENTER_ITEM_QUANTITY",
        failureCode: "INVALID_QUANTITY",
        warnings: readiness.warnings,
      });
    }

    const mutation = replaceCartReviewItemQuantity({
      context: contextFor(input, cartBefore),
      itemId: awaitingItemId,
      quantity: quantityResult.quantity,
    });
    const nextState: CartReviewPreviewState = {
      version: CART_REVIEW_PREVIEW_STATE_VERSION,
      awaitingInput: { kind: "NONE" },
    };
    return result({
      handled: true,
      success: mutation.success,
      changed: mutation.changed,
      cartBefore,
      cartAfter: mutation.cartAfter,
      ...(mutation.review ? { review: mutation.review } : {}),
      ...(mutation.review && mutation.commercialEvaluation
        ? { presentation: mainPresentation({ review: mutation.review, commercialState: mutation.commercialEvaluation.state, conversationalProductName: input.productContext.conversationalName }) }
        : {}),
      ...(mutation.commercialEvaluation ? { commercialEvaluation: mutation.commercialEvaluation } : {}),
      previewState: nextState,
      ...(mutation.planningResult ? { planningResult: mutation.planningResult } : {}),
      quantityResult,
      nextStep: mutation.success
        ? mutation.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE"
          ? "RESOLVE_COMMERCIAL_STATE"
          : "SHOW_CART_REVIEW"
        : "BLOCKED",
      failureCode: mutation.failureCode,
      warnings: mutation.warnings,
    });
  }

  if (input.cartReviewText !== undefined) {
    return result({ handled: false, success: false, changed: false, cartBefore, previewState });
  }

  if (typeof input.rawActionId !== "string" || !input.rawActionId.trim()) {
    const readiness = inspectCartReviewReadiness(contextFor(input, cartBefore));
    if (!readiness.ready) {
      return blockedFromReadiness({ cartBefore, previewState, readiness });
    }
    return result({
      handled: true,
      success: true,
      changed: false,
      cartBefore,
      review: readiness.review,
      presentation: mainPresentation({ review: readiness.review!, commercialState: readiness.commercialEvaluation?.state, conversationalProductName: input.productContext.conversationalName }),
      commercialEvaluation: readiness.commercialEvaluation,
      previewState,
      nextStep: readiness.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE"
        ? "RESOLVE_COMMERCIAL_STATE"
        : "SHOW_CART_REVIEW",
      warnings: readiness.warnings,
    });
  }

  const normalization = normalizeCartReviewAction(input.rawActionId);
  if (!normalization.recognized) {
    return result({ handled: false, success: false, changed: false, cartBefore, previewState });
  }
  if (!normalization.valid || !normalization.action) {
    return result({
      handled: true,
      success: false,
      changed: false,
      cartBefore,
      previewState,
      nextStep: "BLOCKED",
      failureCode: normalization.failureCode,
    });
  }

  const action = normalization.action;
  const readiness = inspectCartReviewReadiness(contextFor(input, cartBefore));
  if (!readiness.ready) {
    return blockedFromReadiness({ cartBefore, previewState, readiness, normalizedAction: action });
  }
  const review = readiness.review!;
  const commercialEvaluation = readiness.commercialEvaluation!;

  if (action.type === "CONTINUE") {
    if (commercialEvaluation.state === "SELECTED_OFFER_INELIGIBLE") {
      return result({
        handled: true,
        success: false,
        changed: false,
        cartBefore,
        review,
        presentation: buildCommercialResolutionPresentation(),
        commercialEvaluation,
        previewState,
        normalizedAction: action,
        nextStep: "RESOLVE_COMMERCIAL_STATE",
        failureCode: "SELECTED_OFFER_INELIGIBLE",
        warnings: readiness.warnings,
      });
    }
    return result({
      handled: true,
      success: true,
      changed: false,
      cartBefore,
      review,
      presentation: buildCartReviewPresentation(
        review,
        input.productContext.conversationalName,
      ),
      commercialEvaluation,
      previewState,
      normalizedAction: action,
      nextStep: "DELIVERY_COLLECTION_READY",
      warnings: readiness.warnings,
    });
  }

  if (action.type === "EDIT") {
    return result({
      handled: true,
      success: true,
      changed: false,
      cartBefore,
      review,
      presentation: buildCartReviewItemSelectorPresentation(review),
      commercialEvaluation,
      previewState: { ...previewState, awaitingInput: { kind: "NONE" } },
      normalizedAction: action,
      nextStep: "SELECT_CART_ITEM",
      warnings: readiness.warnings,
    });
  }

  if (action.type === "BACK") {
    const nextState: CartReviewPreviewState = { version: CART_REVIEW_PREVIEW_STATE_VERSION, awaitingInput: { kind: "NONE" }, ...(previewState.standardAccepted ? { standardAccepted: true } : {}) };
    return result({
      handled: true,
      success: true,
      changed: false,
      cartBefore,
      review,
      presentation: mainPresentation({ review, commercialState: commercialEvaluation.state }),
      commercialEvaluation,
      previewState: nextState,
      normalizedAction: action,
      nextStep: commercialEvaluation.state === "SELECTED_OFFER_INELIGIBLE" ? "RESOLVE_COMMERCIAL_STATE" : "SHOW_CART_REVIEW",
      warnings: readiness.warnings,
    });
  }

  if (action.type === "SELECT_ITEM") {
    const item = review.items.find((candidate) => candidate.id === action.itemId);
    if (!item) {
      return result({ handled: true, success: false, changed: false, cartBefore, review, commercialEvaluation, previewState, normalizedAction: action, nextStep: "BLOCKED", failureCode: "UNKNOWN_CART_ITEM", warnings: readiness.warnings });
    }
    return result({
      handled: true,
      success: true,
      changed: false,
      cartBefore,
      review,
      presentation: buildCartReviewItemActionsPresentation(item),
      commercialEvaluation,
      previewState: { ...previewState, awaitingInput: { kind: "NONE" }, selectedItemId: item.id },
      normalizedAction: action,
      nextStep: "SHOW_ITEM_ACTIONS",
      warnings: readiness.warnings,
    });
  }

  if (action.type === "EDIT_ITEM_QUANTITY") {
    const item = review.items.find((candidate) => candidate.id === action.itemId);
    if (!item) {
      return result({ handled: true, success: false, changed: false, cartBefore, review, commercialEvaluation, previewState, normalizedAction: action, nextStep: "BLOCKED", failureCode: "UNKNOWN_CART_ITEM", warnings: readiness.warnings });
    }
    if (previewState.selectedItemId !== item.id) {
      return result({ handled: true, success: false, changed: false, cartBefore, review, commercialEvaluation, previewState, normalizedAction: action, nextStep: "BLOCKED", failureCode: "ITEM_NOT_SELECTED", warnings: readiness.warnings });
    }
    return result({
      handled: true,
      success: true,
      changed: false,
      cartBefore,
      review,
      presentation: buildCartReviewQuantityInputPresentation(item),
      commercialEvaluation,
      previewState: { ...previewState, awaitingInput: { kind: "EDIT_CART_ITEM_QUANTITY", itemId: item.id } },
      normalizedAction: action,
      nextStep: "ENTER_ITEM_QUANTITY",
      warnings: readiness.warnings,
    });
  }

  if (action.type === "REMOVE_ITEM") {
    if (previewState.selectedItemId !== action.itemId) {
      return result({ handled: true, success: false, changed: false, cartBefore, review, commercialEvaluation, previewState, normalizedAction: action, nextStep: "BLOCKED", failureCode: "ITEM_NOT_SELECTED", warnings: readiness.warnings });
    }
    const mutation = removeCartReviewItem({ context: contextFor(input, cartBefore), itemId: action.itemId });
    const nextState: CartReviewPreviewState = { version: CART_REVIEW_PREVIEW_STATE_VERSION, awaitingInput: { kind: "NONE" } };
    return result({
      handled: true,
      success: mutation.success,
      changed: mutation.changed,
      cartBefore,
      cartAfter: mutation.cartAfter,
      ...(mutation.review ? { review: mutation.review } : {}),
      ...(mutation.review && mutation.commercialEvaluation ? { presentation: mainPresentation({ review: mutation.review, commercialState: mutation.commercialEvaluation.state }) } : {}),
      ...(mutation.commercialEvaluation ? { commercialEvaluation: mutation.commercialEvaluation } : {}),
      previewState: nextState,
      ...(mutation.planningResult ? { planningResult: mutation.planningResult } : {}),
      normalizedAction: action,
      nextStep: mutation.success ? (mutation.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE" ? "RESOLVE_COMMERCIAL_STATE" : "SHOW_CART_REVIEW") : "BLOCKED",
      failureCode: mutation.failureCode,
      warnings: mutation.warnings,
    });
  }

  if (action.type === "USE_STANDARD") {
    if (commercialEvaluation.state !== "SELECTED_OFFER_INELIGIBLE" && !previewState.standardAccepted) {
      return result({ handled: true, success: false, changed: false, cartBefore, review, commercialEvaluation, previewState, normalizedAction: action, nextStep: "BLOCKED", failureCode: "SELECTED_OFFER_NOT_INELIGIBLE", warnings: readiness.warnings });
    }
    const mutation = useStandardAfterOfferLoss(contextFor(input, cartBefore));
    const nextState: CartReviewPreviewState = { version: CART_REVIEW_PREVIEW_STATE_VERSION, awaitingInput: { kind: "NONE" }, standardAccepted: mutation.success || previewState.standardAccepted };
    return result({
      handled: true,
      success: mutation.success,
      changed: mutation.changed,
      cartBefore,
      cartAfter: mutation.cartAfter,
      ...(mutation.review ? { review: mutation.review } : {}),
      ...(mutation.review && mutation.commercialEvaluation ? { presentation: buildCartReviewPresentation(mutation.review, input.productContext.conversationalName) } : {}),
      ...(mutation.commercialEvaluation ? { commercialEvaluation: mutation.commercialEvaluation } : {}),
      previewState: nextState,
      ...(mutation.planningResult ? { planningResult: mutation.planningResult } : {}),
      normalizedAction: action,
      nextStep: mutation.success ? "SHOW_CART_REVIEW" : "BLOCKED",
      failureCode: mutation.failureCode,
      warnings: mutation.warnings,
    });
  }

  const mutation = incrementCartReviewTarget(contextFor(input, cartBefore));
  if (!mutation.success) {
    return result({ handled: true, success: false, changed: false, cartBefore, cartAfter: mutation.cartAfter, previewState, normalizedAction: action, ...(mutation.planningResult ? { planningResult: mutation.planningResult } : {}), nextStep: "BLOCKED", failureCode: mutation.failureCode, warnings: mutation.warnings });
  }
  const itemCollectionPreview = runItemCollectionPreview({
    previewEnabled: true,
    previewState: { version: 1 },
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
    cart: mutation.cartAfter,
  });
  return result({
    handled: true,
    success: itemCollectionPreview.success,
    changed: mutation.changed || itemCollectionPreview.route === "COLLECTION_STARTED",
    cartBefore,
    cartAfter: itemCollectionPreview.cartAfter,
    previewState: { version: CART_REVIEW_PREVIEW_STATE_VERSION, awaitingInput: { kind: "NONE" } },
    itemCollectionPreview,
    ...(mutation.planningResult ? { planningResult: mutation.planningResult } : {}),
    normalizedAction: action,
    nextStep: itemCollectionPreview.success ? "RETURN_TO_ITEM_COLLECTION" : "BLOCKED",
    ...(itemCollectionPreview.success ? {} : { failureCode: "CART_MUTATION_REJECTED" as const }),
    warnings: [...mutation.warnings, ...itemCollectionPreview.warnings],
  });
}
