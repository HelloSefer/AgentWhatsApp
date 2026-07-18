import type { ProductOfferLookupResult } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import type { AgentReplyUiHint } from "../../reply/reply-renderer.types";
import type { CartCommercialEvaluation } from "../commercial/cart-commercial-evaluation.types";
import type { CartDraft } from "../cart-state.types";
import type { ItemCollectionPreviewResult } from "../item-collection/preview/item-collection-preview.types";
import type { CartPlanningResult } from "../planning/cart-planning.types";
import type { CartQuantityInputResult } from "../planning/quantity/cart-quantity-input.types";
import type {
  CartItemEditFailureCode,
  CartItemEditPreviewResult,
  CartItemEditPreviewState,
} from "./item-edit/cart-item-edit.types";

export const CART_REVIEW_PREVIEW_STATE_VERSION = 1 as const;
export const MAX_CART_REVIEW_ACTION_ID_LENGTH = 200;
export const MAX_CART_REVIEW_ITEM_ID_LENGTH = 120;

export type CartReviewAwaitingInput =
  | { kind: "NONE" }
  | { kind: "EDIT_CART_ITEM_QUANTITY"; itemId: string };

export type CartReviewPreviewState = {
  version: typeof CART_REVIEW_PREVIEW_STATE_VERSION;
  awaitingInput: CartReviewAwaitingInput;
  selectedItemId?: string;
  standardAccepted?: boolean;
};

export type CartReviewContext = {
  sellerId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
  offerLookup: ProductOfferLookupResult;
  cart: CartDraft;
  now: Date;
};

export type CartReviewFailureCode =
  | "PREVIEW_STATE_REQUIRED"
  | "INVALID_REVIEW_STATE"
  | "INVALID_CART"
  | "INVALID_TARGET_ITEM_COUNT"
  | "TARGET_NOT_FULFILLED"
  | "TARGET_OVERFILLED"
  | "CURRENT_ITEM_PRESENT"
  | "EMPTY_CART"
  | "PRODUCT_MISMATCH"
  | "COMMERCIAL_STATE_BLOCKED"
  | "SELECTED_OFFER_INELIGIBLE"
  | "SELECTED_OFFER_NOT_INELIGIBLE"
  | "UNKNOWN_CART_ITEM"
  | "ITEM_NOT_SELECTED"
  | "LAST_ITEM_REMOVAL_NOT_ALLOWED"
  | "INVALID_QUANTITY"
  | "CART_MUTATION_REJECTED"
  | "PLANNING_COMMAND_REJECTED"
  | "STALE_PREVIEW_STATE"
  | "CONFLICTING_CART_REVIEW_STATE";

export type CartReviewActionFailureCode =
  | "NOT_CART_REVIEW_ACTION"
  | "MALFORMED_CART_REVIEW_ACTION"
  | "UNSAFE_CART_ITEM_ID";

export type CartReviewAction =
  | { type: "CONTINUE"; rawId: "cart_review:continue" }
  | { type: "ADD_ITEM"; rawId: "cart_review:add_item" }
  | { type: "EDIT"; rawId: "cart_review:edit" }
  | { type: "BACK"; rawId: "cart_review:back" }
  | { type: "USE_STANDARD"; rawId: "cart_review:use_standard" }
  | { type: "SELECT_ITEM"; rawId: `cart_review_item:select:${string}`; itemId: string }
  | { type: "EDIT_ITEM_QUANTITY"; rawId: `cart_review_item:quantity:${string}`; itemId: string }
  | { type: "EDIT_ITEM_OPTIONS"; rawId: `cart_review_item:options:${string}`; itemId: string }
  | { type: "REMOVE_ITEM"; rawId: `cart_review_item:remove:${string}`; itemId: string };

export type CartReviewActionNormalizationResult = {
  recognized: boolean;
  valid: boolean;
  action?: CartReviewAction;
  failureCode?: CartReviewActionFailureCode;
};

export type CartReviewItemOptionSnapshot = Readonly<{
  key: string;
  label: string;
  value: string | number | boolean;
}>;

export type CartReviewItemSnapshot = Readonly<{
  id: string;
  productId: string;
  quantity: number;
  options: readonly CartReviewItemOptionSnapshot[];
}>;

export type CartReviewSnapshot = Readonly<{
  items: readonly CartReviewItemSnapshot[];
  completedUnits: number;
  cartLineCount: number;
  targetUnits: number;
  selectedOfferId?: string;
  standardSubtotal?: number;
  selectedOfferTotal?: number;
  recommendedOffer?: Readonly<{ offerId: string; total: number }>;
  warnings: readonly string[];
}>;

export type CartReviewPresentationKind =
  | "CART_REVIEW"
  | "ITEM_SELECTOR"
  | "ITEM_ACTIONS"
  | "QUANTITY_INPUT"
  | "ITEM_OPTION_EDIT"
  | "ITEM_OPTION_TEXT_INPUT"
  | "BLOCKED";

export type CartReviewPresentationPromptKey =
  | "CART_REVIEW"
  | "SELECT_CART_ITEM"
  | "CART_ITEM_ACTIONS"
  | "EDIT_CART_ITEM_QUANTITY"
  | "EDIT_CART_ITEM_OPTIONS"
  | "ENTER_CART_ITEM_OPTION_TEXT"
  | "RESOLVE_COMMERCIAL_STATE"
  | "BLOCKED";

export type CartReviewPresentationResult = {
  success: boolean;
  kind: CartReviewPresentationKind;
  promptKey: CartReviewPresentationPromptKey;
  text?: string;
  uiHints?: AgentReplyUiHint;
  selectedItemId?: string;
  warnings: string[];
};

export type CartReviewReadiness = {
  ready: boolean;
  failureCode?: CartReviewFailureCode;
  review?: CartReviewSnapshot;
  commercialEvaluation?: CartCommercialEvaluation;
  warnings: string[];
};

export type CartReviewMutationResult = {
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  review?: CartReviewSnapshot;
  commercialEvaluation?: CartCommercialEvaluation;
  planningResult?: CartPlanningResult;
  failureCode?: CartReviewFailureCode;
  warnings: string[];
};

export type CartReviewNextStep =
  | "SHOW_CART_REVIEW"
  | "SELECT_CART_ITEM"
  | "SHOW_ITEM_ACTIONS"
  | "ENTER_ITEM_QUANTITY"
  | "RETURN_TO_ITEM_COLLECTION"
  | "DELIVERY_COLLECTION_READY"
  | "RESOLVE_COMMERCIAL_STATE"
  | "BLOCKED";

export type CartReviewPreviewInput = {
  previewEnabled: boolean;
  rawActionId?: unknown;
  cartReviewText?: unknown;
  previewState?: CartReviewPreviewState;
  cartItemEditPreviewState?: CartItemEditPreviewState;
  cart?: CartDraft;
  sellerId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
  offerLookup: ProductOfferLookupResult;
  now: Date;
};

export type CartReviewPreviewResult = {
  handled: boolean;
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  review?: CartReviewSnapshot;
  presentation?: CartReviewPresentationResult;
  commercialEvaluation?: CartCommercialEvaluation;
  previewState: CartReviewPreviewState;
  itemCollectionPreview?: ItemCollectionPreviewResult;
  planningResult?: CartPlanningResult;
  quantityResult?: CartQuantityInputResult;
  cartItemEditPreview?: CartItemEditPreviewResult;
  cartItemEditPreviewState?: CartItemEditPreviewState;
  normalizedAction?: CartReviewAction;
  nextStep?: CartReviewNextStep;
  failureCode?: CartReviewFailureCode | CartReviewActionFailureCode | CartItemEditFailureCode | "MALFORMED_ITEM_EDIT_ACTION" | "UNSAFE_ITEM_EDIT_FIELD" | "INVALID_ITEM_OPTION_ACTION";
  warnings: string[];
};
