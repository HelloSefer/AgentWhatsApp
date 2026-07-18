import type { ProductOfferLookupResult } from "../../../config/offers/offer-config.service";
import type { ProductContext } from "../../../config/product-context.types";
import type { CartDraft } from "../../cart-state.types";
import type { CartPlanningAction } from "../actions/cart-planning-action.types";
import type { CartPlanningPresentationResult } from "../presentation/cart-planning-presentation.types";
import type { CartPlanningResult } from "../cart-planning.types";

export type CartPlanningPreviewRoute =
  | "OFFER_SELECTOR"
  | "QUANTITY_SELECTOR"
  | "PLANNING_ACTION"
  | "REQUEST_CUSTOM_QUANTITY"
  | "NOT_HANDLED"
  | "UNAVAILABLE";

export type CartPlanningPreviewNextStep =
  | "SELECT_OFFER"
  | "SELECT_QUANTITY"
  | "REQUEST_CUSTOM_QUANTITY"
  | "START_ITEM_COLLECTION";

export type CartPlanningPreviewInput = {
  previewEnabled: boolean;
  rawActionId: unknown;
  sellerId: string;
  productContext: ProductContext;
  offerLookup: ProductOfferLookupResult;
  cart?: CartDraft;
  now: Date;
};

export type CartPlanningPreviewResult = {
  handled: boolean;
  route: CartPlanningPreviewRoute;
  normalizedAction?: CartPlanningAction;
  selector?: CartPlanningPresentationResult;
  planningResult?: CartPlanningResult;
  nextStep?: CartPlanningPreviewNextStep;
  prompt?: {
    key: "REQUEST_CUSTOM_QUANTITY";
    previewOnly: true;
  };
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  warnings: string[];
  failureCode?: string;
};
