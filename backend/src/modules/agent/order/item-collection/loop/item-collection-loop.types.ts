import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import type { CartDraft } from "../../cart-state.types";
import type { ItemCollectionCommandResult, ItemCollectionFailureCode } from "../item-collection.types";
import type { ItemCollectionPresentationResult } from "../presentation/item-collection-presentation.types";
import type { ItemCollectionProgressionResult } from "../progression/item-collection-progression.types";
import type { CurrentItemQuantityFailureCode, CurrentItemQuantityResult } from "../quantity/current-item-quantity.types";

export type ItemCollectionLoopNextStep =
  | "SELECT_ITEM_OPTION"
  | "ENTER_ITEM_OPTION"
  | "ENTER_ITEM_QUANTITY"
  | "CART_REVIEW_READY"
  | "RETRY_ITEM_QUANTITY"
  | "BLOCKED";

export type ItemCollectionLoopFailureCode =
  | ItemCollectionFailureCode
  | CurrentItemQuantityFailureCode
  | "CURRENT_ITEM_MISSING"
  | "QUANTITY_NOT_CURRENTLY_EXPECTED"
  | "FINALIZATION_NOT_READY";

export type ItemCollectionLoopInput = {
  cart: CartDraft;
  sellerId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
  quantityText: unknown;
};

export type ItemCollectionLoopResult = {
  handled: boolean;
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  quantityResult?: CurrentItemQuantityResult;
  collectionResult?: ItemCollectionCommandResult;
  progression?: ItemCollectionProgressionResult;
  presentation?: ItemCollectionPresentationResult;
  finalizedItem?: boolean;
  nextItemStarted?: boolean;
  nextStep?: ItemCollectionLoopNextStep;
  failureCode?: ItemCollectionLoopFailureCode;
  warnings: string[];
};
