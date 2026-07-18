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
import type {
  CartPlanningPreviewInput,
  CartPlanningPreviewResult,
} from "./cart-planning-preview.types";

const ORDER_NOW_ACTION_ID = "first_entry:order_now";

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
}): CartPlanningPreviewResult {
  return {
    handled: input.handled,
    route: input.route,
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

  if (!input.previewEnabled) {
    return result({ cartBefore, handled: false, route: "NOT_HANDLED" });
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
        ...result({ cartBefore, handled: true, route: "OFFER_SELECTOR" }),
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
      }),
      selector: quantitySelector,
      nextStep: "SELECT_QUANTITY",
    };
  }

  const normalization = normalizeCartPlanningAction(input.rawActionId);
  if (!normalization.recognized) {
    return result({ cartBefore, handled: false, route: "NOT_HANDLED" });
  }

  if (!normalization.valid || !normalization.action) {
    return result({
      cartBefore,
      handled: true,
      route: "PLANNING_ACTION",
      failureCode: normalization.failureCode,
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
    return {
      ...result({ cartBefore, handled: true, route: "REQUEST_CUSTOM_QUANTITY" }),
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
    }),
    normalizedAction: handled.action,
    planningResult: handled.planningResult,
    ...(handled.planningResult?.success ? { nextStep: "START_ITEM_COLLECTION" as const } : {}),
  };
}
