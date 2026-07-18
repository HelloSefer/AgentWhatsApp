import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import type { CartDraft } from "../../cart-state.types";
import type { ItemCollectionCommandResult, ItemCollectionFailureCode } from "../item-collection.types";
import type { ItemCollectionProgressionResult } from "../progression/item-collection-progression.types";

export type ItemOptionAction = {
  type: "SELECT_ITEM_OPTION";
  rawId: string;
  fieldKey: string;
  canonicalValue: string;
};

export type ItemOptionActionNormalizationFailureCode =
  | "NOT_ITEM_OPTION_ACTION"
  | "MALFORMED_ACTION_ID"
  | "EMPTY_FIELD_KEY"
  | "EMPTY_CANONICAL_VALUE"
  | "UNSAFE_FIELD_KEY"
  | "UNSAFE_CANONICAL_VALUE"
  | "ACTION_ID_TOO_LONG"
  | "EXTRA_ACTION_SEGMENT";

export type ItemOptionActionNormalizationResult = {
  recognized: boolean;
  valid: boolean;
  action?: ItemOptionAction;
  failureCode?: ItemOptionActionNormalizationFailureCode;
};

export type ItemOptionActionHandleFailureCode =
  | ItemOptionActionNormalizationFailureCode
  | ItemCollectionFailureCode
  | "ACTION_NOT_VALID"
  | "CURRENT_ITEM_MISSING"
  | "PROGRESSION_NOT_COLLECTING_OPTION"
  | "FIELD_NOT_CURRENTLY_EXPECTED"
  | "FIELD_NOT_CONFIGURED"
  | "OPEN_TEXT_ACTION_NOT_SUPPORTED"
  | "CANONICAL_VALUE_NOT_CONFIGURED";

export type ItemOptionActionHandlerInput = {
  action: ItemOptionAction;
  cart: CartDraft;
  sellerId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
};

export type ItemOptionActionHandleResult = {
  handled: boolean;
  success: boolean;
  changed: boolean;
  action?: ItemOptionAction;
  collectionResult?: ItemCollectionCommandResult;
  progression?: ItemCollectionProgressionResult;
  failureCode?: ItemOptionActionHandleFailureCode;
  warnings: string[];
};
