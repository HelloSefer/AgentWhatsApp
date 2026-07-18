import { initializeCart } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import {
  handleCartPlanningAction,
} from "../actions/cart-planning-action-handler.service";
import { normalizeCartPlanningAction } from "../actions/cart-planning-action-normalizer.service";
import { inspectCartPlanningReadiness } from "../cart-planning.service";
import {
  buildOfferSelectorPresentation,
  buildStandardQuantitySelectorPresentation,
} from "../presentation/cart-planning-presentation.service";
import {
  beginCartCustomQuantityAwaiting,
  handleCartCustomQuantityInput,
} from "../quantity/flow/cart-custom-quantity-flow.service";
import {
  CART_PLANNING_PREVIEW_STATE_VERSION,
  type CartPlanningPreviewState,
} from "../quantity/flow/cart-custom-quantity-flow.types";
import type {
  CartPlanningPreviewInput,
  CartPlanningPreviewResult,
} from "./cart-planning-preview.types";

const ORDER_NOW_ACTION_ID = "first_entry:order_now";

function normalizePreviewPlanningState(
  state: CartPlanningPreviewState | undefined,
): CartPlanningPreviewState {
  if (state?.version === CART_PLANNING_PREVIEW_STATE_VERSION && state.awaitingInput?.kind === "CUSTOM_QUANTITY") {
    return {
      version: CART_PLANNING_PREVIEW_STATE_VERSION,
      awaitingInput: {
        kind: "CUSTOM_QUANTITY",
        attempts: state.awaitingInput.attempts,
        ...(state.awaitingInput.startedAt ? { startedAt: state.awaitingInput.startedAt } : {}),
      },
    };
  }

  return { version: CART_PLANNING_PREVIEW_STATE_VERSION, awaitingInput: { kind: "NONE" } };
}

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

function result(input: {
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
  handled: boolean;
  route: CartPlanningPreviewResult["route"];
  warnings?: string[];
  failureCode?: string;
  previewPlanningState?: CartPlanningPreviewState;
}): CartPlanningPreviewResult {
  return {
    handled: input.handled,
    route: input.route,
    previewPlanningState: normalizePreviewPlanningState(input.previewPlanningState),
    cartBefore: cloneCart(input.cartBefore),
    cartAfter: cloneCart(input.cartAfter || input.cartBefore),
    warnings: [...(input.warnings || [])],
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  };
}

/**
 * Preview-only Order Now orchestration. It accepts detached cart state and
 * never reads or writes production sessions, messages, or order records.
 */
export function runCartPlanningPreview(
  input: CartPlanningPreviewInput,
): CartPlanningPreviewResult {
  const cartBefore = cloneCart(input.cart || initializeCart());
  const previewPlanningState = normalizePreviewPlanningState(input.previewPlanningState);

  if (!input.previewEnabled) {
    return result({ cartBefore, handled: false, route: "NOT_HANDLED", previewPlanningState });
  }

  if (previewPlanningState.awaitingInput.kind === "CUSTOM_QUANTITY" && input.planningText !== undefined) {
    const customQuantity = handleCartCustomQuantityInput({
      cart: cartBefore,
      awaitingInput: previewPlanningState.awaitingInput,
      planningText: input.planningText,
      planningContext: {
        sellerId: input.sellerId,
        productContext: input.productContext,
        cart: cartBefore,
        offerLookup: input.offerLookup,
        now: input.now,
      },
    });
    return {
      ...result({
        cartBefore,
        cartAfter: customQuantity.cartAfter,
        handled: customQuantity.handled,
        route: customQuantity.nextStep === "CUSTOM_QUANTITY_EXHAUSTED"
          ? "UNAVAILABLE"
          : customQuantity.nextStep === "START_ITEM_COLLECTION"
            ? "PLANNING_ACTION"
            : "REQUEST_CUSTOM_QUANTITY",
        warnings: customQuantity.warnings,
        failureCode: customQuantity.failureCode,
        previewPlanningState: {
          version: CART_PLANNING_PREVIEW_STATE_VERSION,
          awaitingInput: customQuantity.awaitingInput,
        },
      }),
      quantityResult: customQuantity.quantityResult,
      planningResult: customQuantity.planningResult,
      nextStep: customQuantity.nextStep,
      ...(customQuantity.nextStep === "RETRY_CUSTOM_QUANTITY" || customQuantity.nextStep === "REQUEST_CUSTOM_QUANTITY"
        ? { prompt: { key: "REQUEST_CUSTOM_QUANTITY" as const, previewOnly: true as const } }
        : {}),
    };
  }

  if (input.rawActionId === ORDER_NOW_ACTION_ID) {
    const readiness = inspectCartPlanningReadiness({
      sellerId: input.sellerId,
      productContext: input.productContext,
      cart: cartBefore,
      offerLookup: input.offerLookup,
      now: input.now,
    });
    if (!readiness.ready) {
      return result({
        cartBefore,
        handled: true,
        route: "UNAVAILABLE",
        warnings: readiness.warnings,
        failureCode: readiness.failureCode,
        previewPlanningState,
      });
    }

    const offerSelector = buildOfferSelectorPresentation({
      sellerId: input.sellerId,
      productContext: input.productContext,
      offerLookup: input.offerLookup,
      now: input.now,
    });
    if (offerSelector.success) {
      return {
        ...result({ cartBefore, handled: true, route: "OFFER_SELECTOR", previewPlanningState }),
        selector: offerSelector,
        nextStep: "SELECT_OFFER",
      };
    }

    if (
      offerSelector.failureCode === "PRODUCT_MISMATCH" ||
      offerSelector.failureCode === "INVALID_EVALUATION_TIME"
    ) {
      return result({
        cartBefore,
        handled: true,
        route: "UNAVAILABLE",
        warnings: offerSelector.warnings,
        failureCode: offerSelector.failureCode,
        previewPlanningState,
      });
    }

    const quantitySelector = buildStandardQuantitySelectorPresentation();
    const invalidConfig = offerSelector.failureCode === "INVALID_OFFER_CONFIG";
    return {
      ...result({
        cartBefore,
        handled: true,
        route: "QUANTITY_SELECTOR",
        warnings: invalidConfig ? ["invalid_offer_config_hidden"] : [],
        ...(invalidConfig ? { failureCode: offerSelector.failureCode } : {}),
        previewPlanningState,
      }),
      selector: quantitySelector,
      nextStep: "SELECT_QUANTITY",
    };
  }

  const normalization = normalizeCartPlanningAction(input.rawActionId);
  if (!normalization.recognized) {
    return result({ cartBefore, handled: false, route: "NOT_HANDLED", previewPlanningState });
  }

  if (!normalization.valid || !normalization.action) {
    return result({
      cartBefore,
      handled: true,
      route: "PLANNING_ACTION",
      failureCode: normalization.failureCode,
      previewPlanningState,
    });
  }

  const handled = handleCartPlanningAction({
    action: normalization.action,
    planningContext: {
      sellerId: input.sellerId,
      productContext: input.productContext,
      cart: cartBefore,
      offerLookup: input.offerLookup,
      now: input.now,
    },
  });

  if (handled.nextStep === "REQUEST_CUSTOM_QUANTITY") {
    const customQuantity = beginCartCustomQuantityAwaiting({
      cart: cartBefore,
      awaitingInput: previewPlanningState.awaitingInput,
    });
    return {
      ...result({
        cartBefore,
        cartAfter: customQuantity.cartAfter,
        handled: true,
        route: "REQUEST_CUSTOM_QUANTITY",
        previewPlanningState: {
          version: CART_PLANNING_PREVIEW_STATE_VERSION,
          awaitingInput: customQuantity.awaitingInput,
        },
      }),
      normalizedAction: handled.action,
      nextStep: "REQUEST_CUSTOM_QUANTITY",
      prompt: { key: "REQUEST_CUSTOM_QUANTITY", previewOnly: true },
    };
  }

  return {
    ...result({
      cartBefore,
      cartAfter: handled.planningResult?.cart || cartBefore,
      handled: true,
      route: "PLANNING_ACTION",
      warnings: handled.planningResult?.warnings || [],
      failureCode: handled.planningResult?.failureCode,
      previewPlanningState,
    }),
    normalizedAction: handled.action,
    planningResult: handled.planningResult,
    ...(handled.planningResult?.success ? { nextStep: "START_ITEM_COLLECTION" as const } : {}),
  };
}
