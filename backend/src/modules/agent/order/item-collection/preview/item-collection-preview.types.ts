import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import type { CartDraft } from "../../cart-state.types";
import type { ItemOptionActionHandleResult } from "../actions/item-option-action.types";
import type { ItemCollectionCommandResult } from "../item-collection.types";
import type { ItemCollectionPresentationResult } from "../presentation/item-collection-presentation.types";
import type { ItemCollectionProgressionResult } from "../progression/item-collection-progression.types";
import type { ItemCollectionLoopResult } from "../loop/item-collection-loop.types";
import type { SameAsPreviousPresentation, SameAsPreviousPreviewState } from "../shortcuts/same-as-previous.types";

export type ItemCollectionPreviewRoute =
  | "COLLECTION_STARTED"
  | "OPTION_ACTION"
  | "QUANTITY_REQUIRED"
  | "LOOP_COMPLETED"
  | "NOT_HANDLED"
  | "BLOCKED";

export type ItemCollectionPreviewNextStep =
  | "SELECT_ITEM_OPTION"
  | "ENTER_ITEM_OPTION"
  | "ENTER_ITEM_QUANTITY"
  | "RETRY_ITEM_QUANTITY"
  | "CART_REVIEW_READY"
  | "SAME_OR_DIFFERENT_ITEM_OPTIONS"
  | "BLOCKED";

export type ItemCollectionPreviewInput = {
  previewEnabled: boolean;
  rawActionId?: unknown;
  itemCollectionText?: unknown;
  previewState?: SameAsPreviousPreviewState;
  cart?: CartDraft;
  sellerId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
};

export type ItemCollectionPreviewResult = {
  handled: boolean;
  success: boolean;
  route: ItemCollectionPreviewRoute;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  collectionResult?: ItemCollectionCommandResult;
  actionResult?: ItemOptionActionHandleResult;
  loopResult?: ItemCollectionLoopResult;
  progression?: ItemCollectionProgressionResult;
  presentation?: ItemCollectionPresentationResult;
  shortcutPresentation?: SameAsPreviousPresentation;
  previewState: SameAsPreviousPreviewState;
  nextStep?: ItemCollectionPreviewNextStep;
  failureCode?: string;
  warnings: string[];
};
