import type { RequiredOrderField } from "../../../config/required-fields.types";
import type {
  ItemCollectionFailureCode,
  ItemCollectionProgress,
} from "../item-collection.types";

export type ItemCollectionProgressionStep =
  | "START_COLLECTION"
  | "START_CURRENT_ITEM"
  | "COLLECT_OPTION"
  | "COLLECT_QUANTITY"
  | "READY_TO_FINALIZE"
  | "START_NEXT_ITEM"
  | "CART_REVIEW_READY"
  | "BLOCKED";

export type ItemCollectionProgressionField = {
  key: string;
  label?: string;
  semanticType?: string;
  required: boolean;
  configuredOrder: number;
};

export type ItemCollectionProgressionResult = {
  success: boolean;
  step: ItemCollectionProgressionStep;
  field?: ItemCollectionProgressionField;
  progress: ItemCollectionProgress;
  failureCode?: ItemCollectionFailureCode;
  invalidFields: string[];
  warnings: string[];
};

export type ItemCollectionProgressionInput = {
  cart: import("../../cart-state.types").CartDraft;
  sellerId: string;
  productContext: import("../../../config/product-context.types").ProductContext;
  requiredFields: RequiredOrderField[];
};
