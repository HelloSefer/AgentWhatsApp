import type { ProductOfferLookupResult } from "../../../config/offers/offer-config.service";
import type { ProductContext } from "../../../config/product-context.types";
import type { AgentReplyUiHint } from "../../../reply/reply-renderer.types";

export type CartPlanningSelectorKind =
  | "OFFER_BUTTONS"
  | "OFFER_LIST"
  | "QUANTITY_BUTTONS"
  | "UNAVAILABLE";

export type CartPlanningPresentationFailureCode =
  | "INVALID_OFFER_CONFIG"
  | "NO_AVAILABLE_OFFERS"
  | "PRODUCT_MISMATCH"
  | "INVALID_EVALUATION_TIME";

export type CartOfferActionId = `cart_offer:${string}`;
export type CartQuantityActionId = `cart_quantity:${number}` | "cart_quantity:more";
export const MAX_CART_PLANNING_ACTION_ID_LENGTH = 200;

export type OfferSelectorPresentationInput = {
  sellerId: string;
  productContext: ProductContext;
  offerLookup: ProductOfferLookupResult;
  now: Date;
};

export type CartPlanningPresentationResult = {
  success: boolean;
  kind: CartPlanningSelectorKind;
  promptKey: "SELECT_OFFER" | "SELECT_QUANTITY";
  text?: string;
  uiHints?: AgentReplyUiHint;
  /** A later action-normalization phase may expose this alongside quick buttons. */
  moreQuantityAction?: CartQuantityActionId;
  optionCount: number;
  failureCode?: CartPlanningPresentationFailureCode;
  warnings: string[];
};
