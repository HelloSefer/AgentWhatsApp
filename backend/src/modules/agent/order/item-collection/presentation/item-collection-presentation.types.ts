import type { RequiredOrderField } from "../../../config/required-fields.types";
import type { ItemCollectionFailureCode, ItemCollectionProgress } from "../item-collection.types";
import type { ItemCollectionProgressionResult } from "../progression/item-collection-progression.types";
import type { AgentReplyUiHint } from "../../../reply/reply-renderer.types";

export type ItemCollectionPresentationKind =
  | "OPTION_BUTTONS"
  | "OPTION_LIST"
  | "OPTION_TEXT_INPUT"
  | "QUANTITY_INPUT"
  | "READY_TO_FINALIZE"
  | "START_NEXT_ITEM"
  | "CART_REVIEW_READY"
  | "START_COLLECTION"
  | "BLOCKED";

export type ItemCollectionPresentationPromptKey =
  | "SELECT_ITEM_OPTION"
  | "ENTER_ITEM_OPTION"
  | "SELECT_ITEM_QUANTITY"
  | "CURRENT_ITEM_READY"
  | "START_NEXT_ITEM"
  | "CART_REVIEW_READY"
  | "START_COLLECTION"
  | "BLOCKED";

export type ItemCollectionPresentationFailureCode =
  | ItemCollectionFailureCode
  | "FIELD_NOT_CONFIGURED"
  | "UNSAFE_ACTION_ID"
  | "DUPLICATE_ACTION_ID";

export type ItemCollectionPresentationField = {
  key: string;
  label?: string;
  semanticType?: string;
};

export type ItemCollectionPresentationResult = {
  success: boolean;
  kind: ItemCollectionPresentationKind;
  promptKey: ItemCollectionPresentationPromptKey;
  text?: string;
  field?: ItemCollectionPresentationField;
  uiHints?: AgentReplyUiHint;
  progress: ItemCollectionProgress;
  itemNumber?: number;
  failureCode?: ItemCollectionPresentationFailureCode;
  warnings: string[];
};

export type ItemCollectionPresentationInput = {
  progression: ItemCollectionProgressionResult;
  requiredFields: RequiredOrderField[];
  /** Optional configured display labels keyed by canonical option value. */
  optionDisplayLabels?: Readonly<Record<string, string>>;
};

export type ItemCollectionOptionActionId = `cart_item_option:${string}:${string}`;
