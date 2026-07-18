import type { CartPlanningContext, CartPlanningResult } from "../cart-planning.types";

export type CartPlanningAction =
  | {
      type: "SELECT_OFFER";
      rawId: string;
      offerId: string;
    }
  | {
      type: "SELECT_STANDARD_QUANTITY";
      rawId: string;
      quantity: number;
    }
  | {
      type: "REQUEST_MORE_QUANTITY";
      rawId: string;
    };

export type CartPlanningActionFailureCode =
  | "NOT_PLANNING_ACTION"
  | "MALFORMED_ACTION_ID"
  | "EMPTY_OFFER_ID"
  | "INVALID_OFFER_ID"
  | "INVALID_QUANTITY"
  | "UNSUPPORTED_QUANTITY_ACTION"
  | "ACTION_ID_TOO_LONG";

export type CartPlanningActionNormalizationResult = {
  recognized: boolean;
  valid: boolean;
  action?: CartPlanningAction;
  failureCode?: CartPlanningActionFailureCode;
};

export type CartPlanningActionHandleInput = {
  action: CartPlanningAction;
  planningContext: CartPlanningContext;
};

export type CartPlanningActionHandleResult = {
  handled: boolean;
  action: CartPlanningAction;
  planningResult?: CartPlanningResult;
  nextStep?: "REQUEST_CUSTOM_QUANTITY";
};
