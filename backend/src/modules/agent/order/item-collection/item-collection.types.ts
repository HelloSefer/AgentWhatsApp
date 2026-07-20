import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";

export type ItemCollectionNextStep =
  | "COLLECT_CURRENT_ITEM"
  | "START_NEXT_ITEM"
  | "CART_REVIEW_READY";

export type ItemCollectionFailureCode =
  | "INVALID_PRODUCT_CONTEXT"
  | "PRODUCT_MISMATCH"
  | "INVALID_CART"
  | "UNSAFE_CART_STATE"
  | "MISSING_TARGET_ITEM_COUNT"
  | "INVALID_TARGET_ITEM_COUNT"
  | "TARGET_ALREADY_FULFILLED"
  | "TARGET_OVERFILLED"
  | "CURRENT_ITEM_MISSING"
  | "INVALID_ITEM_OPTION"
  | "ORDER_SCOPED_FIELD"
  | "INVALID_ITEM_OPTION_VALUE"
  | "INVALID_ITEM_QUANTITY"
  | "IMPLICIT_PLANNED_QUANTITY"
  | "QUANTITY_EXCEEDS_REMAINING_TARGET"
  | "MISSING_REQUIRED_ITEM_FIELDS"
  | "CART_MUTATION_REJECTED";

export type ItemCollectionContext = {
  sellerId: string;
  productContext: ProductContext;
  requiredFields: RequiredOrderField[];
};

export type ItemCollectionProgress = {
  /** Backward-compatible aliases retained for existing cart/domain consumers. */
  targetUnits: number;
  completedUnits: number;
  remainingUnits: number;
  currentItemNumber?: number;
  /** Initial planning semantics: physical pieces and one-piece slot index. */
  plannedPieceCount?: number;
  completedPieceCount?: number;
  currentSlotIndex?: number;
};

export type ItemCollectionInspection = {
  valid: boolean;
  progress: ItemCollectionProgress;
  requiredItemFields: RequiredOrderField[];
  failureCode?: ItemCollectionFailureCode;
  warnings: string[];
};

export type ItemCollectionCommandResult = {
  success: boolean;
  changed: boolean;
  cart: CartDraft;
  progress: ItemCollectionProgress;
  requiredItemFields: RequiredOrderField[];
  nextStep?: ItemCollectionNextStep;
  missingItemFields?: string[];
  invalidItemFields?: string[];
  failureCode?: ItemCollectionFailureCode;
  warnings: string[];
};

export type SetCurrentItemOptionInput = ItemCollectionContext & {
  cart: CartDraft;
  optionKey: string;
  value: unknown;
};

export type SetCurrentItemQuantityInput = ItemCollectionContext & {
  cart: CartDraft;
  quantity: unknown;
};

export type ItemCollectionCommandInput = ItemCollectionContext & {
  cart: CartDraft;
};

export type ValidatedItemOption = {
  field: RequiredOrderField;
  value: SupportedOrderFieldValue;
};
