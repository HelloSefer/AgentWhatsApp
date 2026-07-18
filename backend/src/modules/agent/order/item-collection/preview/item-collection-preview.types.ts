import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import type { CartDraft } from "../../cart-state.types";
import type { ItemOptionActionHandleResult } from "../actions/item-option-action.types";
import type { ItemCollectionCommandResult } from "../item-collection.types";
import type { ItemCollectionPresentationResult } from "../presentation/item-collection-presentation.types";
import type { ItemCollectionProgressionResult } from "../progression/item-collection-progression.types";

export type ItemCollectionPreviewRoute =
  | "COLLECTION_STARTED"
  | "OPTION_ACTION"
  | "QUANTITY_REQUIRED"
  | "NOT_HANDLED"
  | "BLOCKED";

export type ItemCollectionPreviewNextStep =
  | "SELECT_ITEM_OPTION"
  | "ENTER_ITEM_OPTION"
  | "ENTER_ITEM_QUANTITY";

export type ItemCollectionPreviewInput = {
  previewEnabled: boolean;
  rawActionId?: unknown;
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
  progression?: ItemCollectionProgressionResult;
  presentation?: ItemCollectionPresentationResult;
  nextStep?: ItemCollectionPreviewNextStep;
  failureCode?: string;
  warnings: string[];
};
