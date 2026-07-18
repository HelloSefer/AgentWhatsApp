import type { CartQuantityInputResult } from "../cart-quantity-input.types";
import type { CartDraft } from "../../../cart-state.types";
import type { CartPlanningContext, CartPlanningResult } from "../../cart-planning.types";

export const CART_PLANNING_PREVIEW_STATE_VERSION = 1 as const;
export const MAX_CUSTOM_QUANTITY_ATTEMPTS = 3;

export type CartPlanningAwaitingInput =
  | {
      kind: "CUSTOM_QUANTITY";
      startedAt?: string;
      attempts: number;
    }
  | {
      kind: "NONE";
    };

export type CartPlanningPreviewState = {
  version: typeof CART_PLANNING_PREVIEW_STATE_VERSION;
  awaitingInput: CartPlanningAwaitingInput;
};

export type CartCustomQuantityFlowNextStep =
  | "REQUEST_CUSTOM_QUANTITY"
  | "RETRY_CUSTOM_QUANTITY"
  | "START_ITEM_COLLECTION"
  | "CUSTOM_QUANTITY_EXHAUSTED";

export type CartCustomQuantityFlowResult = {
  handled: boolean;
  success: boolean;
  awaitingInput: CartPlanningAwaitingInput;
  quantityResult?: CartQuantityInputResult;
  planningResult?: CartPlanningResult;
  nextStep?: CartCustomQuantityFlowNextStep;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  failureCode?: string;
  warnings: string[];
};

export type CartCustomQuantityFlowInput = {
  cart: CartDraft;
  awaitingInput: CartPlanningAwaitingInput;
  planningText: unknown;
  planningContext: CartPlanningContext;
};
