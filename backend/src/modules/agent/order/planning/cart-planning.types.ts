import type { ProductOfferLookupResult } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import type { CartDraft } from "../cart-state.types";

export type CartPlanningCommand =
  | "INITIALIZE_STANDARD_PLANNING"
  | "SELECT_STANDARD_QUANTITY"
  | "INITIALIZE_OFFER_PLANNING"
  | "SELECT_OFFER"
  | "CLEAR_PLANNING"
  | "SYNCHRONIZE_REVIEW_TARGET"
  | "INCREMENT_REVIEW_TARGET"
  | "ACCEPT_STANDARD_AFTER_OFFER_LOSS";

export type CartPlanningFailureCode =
  | "INVALID_CART_STATE"
  | "UNKNOWN_OFFER"
  | "INVALID_OFFER_CONFIG"
  | "OFFER_INACTIVE"
  | "OFFER_NOT_STARTED"
  | "OFFER_EXPIRED"
  | "INVALID_QUANTITY"
  | "EXISTING_ITEMS_REQUIRE_RESET"
  | "UNRESOLVED_CURRENT_ITEM"
  | "CART_ALREADY_CONFIRMED"
  | "PRODUCT_MISMATCH"
  | "INVALID_EVALUATION_TIME"
  | "INVALID_REVIEW_STATE"
  | "EMPTY_REVIEW_CART"
  | "SELECTED_OFFER_NOT_INELIGIBLE";

/**
 * Read-only dependencies for cart planning. The caller owns persistence and
 * supplies a seller/product-scoped, already-validated offer lookup.
 */
export type CartPlanningContext = {
  sellerId: string;
  productContext: ProductContext;
  cart: CartDraft;
  offerLookup: ProductOfferLookupResult;
  now: Date;
};

export type CartPlanningReadiness = {
  ready: boolean;
  failureCode?: CartPlanningFailureCode;
  warnings: string[];
};

export type CartPlanningResult = {
  success: boolean;
  command: CartPlanningCommand;
  cart: CartDraft;
  changed: boolean;
  failureCode?: CartPlanningFailureCode;
  warnings: string[];
};
