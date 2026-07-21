import type { ProductOfferLookupResult } from "../../../config/offers/offer-config.service";
import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import type { CartCommercialEvaluation } from "../../commercial/cart-commercial-evaluation.types";
import type { CartDraft, SupportedOrderFieldValue } from "../../cart-state.types";
import type { CartPlanningResult } from "../../planning/cart-planning.types";
import type {
  CartReviewFailureCode,
  CartReviewPresentationResult,
  CartReviewSnapshot,
} from "../cart-review.types";

export const CART_ITEM_EDIT_PREVIEW_STATE_VERSION = 1 as const;
export const MAX_CART_ITEM_EDIT_TEXT_LENGTH = 160;

export type CartItemEditPreviewState = Readonly<{
  version: typeof CART_ITEM_EDIT_PREVIEW_STATE_VERSION;
  kind: "EDIT_CART_ITEM_OPTIONS";
  sourceItemId: string;
  originalItemFingerprint: string;
  workingItem: Readonly<{
    productId: string;
    quantity: number;
    selectedOptions: Readonly<Record<string, SupportedOrderFieldValue>>;
  }>;
  awaitingTextFieldKey?: string;
  focusedFieldKey?: string;
  autoSaveOnSelection?: boolean;
}>;

export type CartItemEditFailureCode =
  | CartReviewFailureCode
  | "PREVIEW_STATE_REQUIRED"
  | "INVALID_ITEM_EDIT_STATE"
  | "CONFLICTING_CART_REVIEW_STATE"
  | "UNKNOWN_CART_ITEM"
  | "INVALID_SOURCE_ITEM_OPTIONS"
  | "STALE_ITEM_EDIT_STATE"
  | "INVALID_ITEM_OPTION"
  | "ORDER_SCOPED_FIELD"
  | "INVALID_ITEM_OPTION_VALUE"
  | "TEXT_FIELD_NOT_OPEN"
  | "TEXT_FIELD_NOT_AWAITED"
  | "INVALID_ITEM_OPTION_TEXT"
  | "MISSING_REQUIRED_ITEM_FIELDS"
  | "CART_MUTATION_REJECTED"
  | "PLANNING_COMMAND_REJECTED"
  | "INVALID_REVIEW_STATE"
  | "INVALID_CART"
  | "PRODUCT_MISMATCH"
  | "COMMERCIAL_STATE_BLOCKED"
  | "SELECTED_OFFER_INELIGIBLE";

export type CartItemEditNextStep =
  | "SELECT_ITEM_OPTION"
  | "ENTER_ITEM_OPTION_TEXT"
  | "REVIEW_ITEM_CHANGES"
  | "RETURN_TO_CART_REVIEW"
  | "RESOLVE_COMMERCIAL_STATE"
  | "BLOCKED";

export type CartItemEditAction =
  | { type: "SELECT_OPTION"; rawId: string; fieldKey: string; canonicalValue: string }
  | { type: "ENTER_TEXT"; rawId: string; fieldKey: string }
  | { type: "SAVE"; rawId: "cart_review_item_edit:save" }
  | { type: "CANCEL"; rawId: "cart_review_item_edit:cancel" };

export type CartItemEditActionNormalizationResult = {
  recognized: boolean;
  valid: boolean;
  action?: CartItemEditAction;
  failureCode?: "MALFORMED_ITEM_EDIT_ACTION" | "UNSAFE_ITEM_EDIT_FIELD" | "INVALID_ITEM_OPTION_ACTION";
};

export type CartItemEditContext = {
  sellerId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
  offerLookup: ProductOfferLookupResult;
  cart: CartDraft;
  now: Date;
};

export type CartItemEditPreviewInput = CartItemEditContext & {
  previewEnabled: boolean;
  rawActionId?: unknown;
  cartReviewText?: unknown;
  editState?: CartItemEditPreviewState;
  startItemId?: string;
  startFieldKey?: string;
  hasCartReviewConflict?: boolean;
};

export type CartItemEditPreviewResult = {
  handled: boolean;
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  editState?: CartItemEditPreviewState;
  review?: CartReviewSnapshot;
  presentation?: CartReviewPresentationResult;
  commercialEvaluation?: CartCommercialEvaluation;
  planningResult?: CartPlanningResult;
  mergedIntoItemId?: string;
  nextStep?: CartItemEditNextStep;
  failureCode?: CartItemEditFailureCode | CartItemEditActionNormalizationResult["failureCode"];
  warnings: string[];
};
