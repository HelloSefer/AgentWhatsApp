import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import type { AgentReplyUiHint } from "../../../reply/reply-renderer.types";
import type { CartDraft } from "../../cart-state.types";
import type { ItemCollectionCommandResult } from "../item-collection.types";
import type { ItemCollectionPresentationResult } from "../presentation/item-collection-presentation.types";
import type { ItemCollectionProgressionResult } from "../progression/item-collection-progression.types";

export const SAME_AS_PREVIOUS_PREVIEW_STATE_VERSION = 1 as const;

export type SameAsPreviousDecision = "same" | "different";

export type SameAsPreviousPreviewState = {
  version: typeof SAME_AS_PREVIOUS_PREVIEW_STATE_VERSION;
  currentItemId?: string;
  decision?: SameAsPreviousDecision;
};

export type SameAsPreviousAction = {
  type: "SAME_AS_PREVIOUS" | "DIFFERENT_CHOICES";
  rawId: "cart_item_previous:same" | "cart_item_previous:different";
};

export type SameAsPreviousActionFailureCode =
  | "NOT_SAME_AS_PREVIOUS_ACTION"
  | "MALFORMED_ACTION_ID";

export type SameAsPreviousActionNormalizationResult = {
  recognized: boolean;
  valid: boolean;
  action?: SameAsPreviousAction;
  failureCode?: SameAsPreviousActionFailureCode;
};

export type SameAsPreviousEligibilityFailureCode =
  | "CURRENT_ITEM_MISSING"
  | "UNSAFE_CART_STATE"
  | "TARGET_ALREADY_FULFILLED"
  | "PRODUCT_MISMATCH"
  | "PREVIOUS_ITEM_MISSING"
  | "OPTIONLESS_PRODUCT"
  | "CURRENT_DRAFT_ALREADY_CONFIGURED"
  | "PREVIOUS_ITEM_OPTIONS_INVALID"
  | "PROGRESSION_NOT_COLLECTING_OPTION"
  | "SHORTCUT_ALREADY_DECIDED";

export type SameAsPreviousEligibilityResult = {
  eligible: boolean;
  failureCode?: SameAsPreviousEligibilityFailureCode;
  previousItemId?: string;
  reusableFieldKeys: string[];
  warnings: string[];
};

export type SameAsPreviousPresentation = {
  promptKey: "SAME_OR_DIFFERENT_ITEM_OPTIONS";
  uiHints: AgentReplyUiHint;
  previewOnly: true;
};

export type SameAsPreviousInput = {
  cart: CartDraft;
  sellerId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
  previewState?: SameAsPreviousPreviewState;
};

export type SameAsPreviousHandleResult = {
  handled: boolean;
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  action?: SameAsPreviousAction;
  collectionResults?: ItemCollectionCommandResult[];
  progression?: ItemCollectionProgressionResult;
  presentation?: ItemCollectionPresentationResult;
  previewState: SameAsPreviousPreviewState;
  failureCode?: SameAsPreviousEligibilityFailureCode | SameAsPreviousActionFailureCode | "PREVIEW_STATE_REQUIRED" | "STALE_PREVIEW_STATE" | "COPY_REJECTED" | "COPY_NOT_COMPLETE";
  warnings: string[];
};
