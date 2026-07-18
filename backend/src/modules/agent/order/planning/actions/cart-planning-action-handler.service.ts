import {
  selectConfiguredOffer,
  selectStandardTargetQuantity,
} from "../cart-planning.service";
import type {
  CartPlanningActionHandleInput,
  CartPlanningActionHandleResult,
} from "./cart-planning-action.types";

function cloneAction<T extends CartPlanningActionHandleInput["action"]>(action: T): T {
  return { ...action };
}

/** Bridges a trusted normalized action to C1 without adding runtime routing. */
export function handleCartPlanningAction(
  input: CartPlanningActionHandleInput,
): CartPlanningActionHandleResult {
  const action = cloneAction(input.action);

  if (action.type === "REQUEST_MORE_QUANTITY") {
    return {
      handled: true,
      action,
      nextStep: "REQUEST_CUSTOM_QUANTITY",
    };
  }

  const planningResult = action.type === "SELECT_OFFER"
    ? selectConfiguredOffer(input.planningContext, action.offerId)
    : selectStandardTargetQuantity(input.planningContext, action.quantity);

  return {
    handled: true,
    action,
    planningResult,
  };
}
