import {
  createItemFingerprint,
  replaceItemOptionsAndMerge,
  setCartStatus,
} from "../../cart-state.service";
import type { CartDraft, CartItem, SupportedOrderFieldValue } from "../../cart-state.types";
import {
  getItemCollectionOptionFields,
  getRequiredItemCollectionFields,
  validateItemCollectionOption,
} from "../../item-collection/item-collection-requirements.service";
import { normalizeItemOptionActionId } from "../../item-collection/actions/item-option-action-normalizer.service";
import { synchronizeReviewTargetToCompletedUnits } from "../../planning/cart-planning.service";
import { inspectCartReviewReadiness } from "../cart-review.service";
import { normalizeCartItemEditText } from "./item-option-text-normalizer.service";
import {
  CART_ITEM_EDIT_PREVIEW_STATE_VERSION,
  type CartItemEditAction,
  type CartItemEditActionNormalizationResult,
  type CartItemEditContext,
  type CartItemEditFailureCode,
  type CartItemEditPreviewState,
} from "./cart-item-edit.types";

const MAX_ITEM_EDIT_ACTION_LENGTH = 200;
const MAX_ITEM_EDIT_FIELD_KEY_LENGTH = 80;
const UNSAFE_ITEM_EDIT_FIELD_KEY = /[:%\s\u0000-\u001F\u007F-\u009F]/u;

type CanonicalOptionsResult =
  | { valid: true; selectedOptions: Record<string, SupportedOrderFieldValue> }
  | { valid: false; failureCode: "INVALID_SOURCE_ITEM_OPTIONS" | "MISSING_REQUIRED_ITEM_FIELDS" | "INVALID_ITEM_OPTION" | "ORDER_SCOPED_FIELD" | "INVALID_ITEM_OPTION_VALUE" };

export type CartItemEditOperationResult = {
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter: CartDraft;
  editState?: CartItemEditPreviewState;
  review?: ReturnType<typeof inspectCartReviewReadiness>["review"];
  commercialEvaluation?: ReturnType<typeof inspectCartReviewReadiness>["commercialEvaluation"];
  planningResult?: ReturnType<typeof synchronizeReviewTargetToCompletedUnits>;
  mergedIntoItemId?: string;
  failureCode?: CartItemEditFailureCode;
  warnings: string[];
};

function cloneCart(cart: CartDraft): CartDraft {
  return {
    ...cart,
    items: cart.items.map((item) => ({ ...item, selectedOptions: { ...item.selectedOptions } })),
    currentItemDraft: cart.currentItemDraft
      ? { ...cart.currentItemDraft, selectedOptions: { ...cart.currentItemDraft.selectedOptions } }
      : undefined,
    orderLevelFields: { ...cart.orderLevelFields },
  };
}

function cloneState(state: CartItemEditPreviewState): CartItemEditPreviewState {
  return {
    version: CART_ITEM_EDIT_PREVIEW_STATE_VERSION,
    kind: "EDIT_CART_ITEM_OPTIONS",
    sourceItemId: state.sourceItemId,
    originalItemFingerprint: state.originalItemFingerprint,
    workingItem: {
      productId: state.workingItem.productId,
      quantity: state.workingItem.quantity,
      selectedOptions: { ...state.workingItem.selectedOptions },
    },
    ...(state.awaitingTextFieldKey ? { awaitingTextFieldKey: state.awaitingTextFieldKey } : {}),
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/gu, "");
}

function isSafeFieldKey(value: string): boolean {
  return Boolean(value) && Array.from(value).length <= MAX_ITEM_EDIT_FIELD_KEY_LENGTH && !UNSAFE_ITEM_EDIT_FIELD_KEY.test(value);
}

function itemEditFingerprint(item: Pick<CartItem, "productId" | "quantity" | "selectedOptions">): string {
  return `${item.quantity}::${createItemFingerprint(item)}`;
}

function matchingFieldKey(fields: CartItemEditContext["requiredFields"], key: string): string | undefined {
  const normalized = normalizeKey(key);
  return fields.find((field) => normalizeKey(field.key) === normalized)?.key;
}

function canonicalizeSelectedOptions(input: {
  fields: CartItemEditContext["requiredFields"];
  selectedOptions: Record<string, SupportedOrderFieldValue>;
}): CanonicalOptionsResult {
  const canonical: Record<string, SupportedOrderFieldValue> = {};
  const seenFields = new Set<string>();

  for (const [key, value] of Object.entries(input.selectedOptions)) {
    const validation = validateItemCollectionOption({ fields: input.fields, optionKey: key, value });
    if (!validation.valid) {
      return {
        valid: false,
        failureCode: validation.failureCode === "INVALID_ITEM_OPTION"
          ? "INVALID_ITEM_OPTION"
          : validation.failureCode,
      };
    }

    const canonicalKey = validation.option.field.key;
    if (seenFields.has(canonicalKey)) {
      return { valid: false, failureCode: "INVALID_ITEM_OPTION" };
    }
    seenFields.add(canonicalKey);
    canonical[canonicalKey] = validation.option.value;
  }

  for (const field of getRequiredItemCollectionFields(input.fields)) {
    if (canonical[field.key] === undefined || canonical[field.key] === null || canonical[field.key] === "") {
      return { valid: false, failureCode: "MISSING_REQUIRED_ITEM_FIELDS" };
    }
  }

  return { valid: true, selectedOptions: canonical };
}

function invalidState(value: unknown): undefined {
  return undefined;
}

/** Accepts only a detached, structurally safe preview state. */
export function normalizeCartItemEditPreviewState(value: unknown): CartItemEditPreviewState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidState(value);
  const state = value as Record<string, unknown>;
  const workingItem = state.workingItem;
  if (
    state.version !== CART_ITEM_EDIT_PREVIEW_STATE_VERSION ||
    state.kind !== "EDIT_CART_ITEM_OPTIONS" ||
    typeof state.sourceItemId !== "string" ||
    !isSafeFieldKey(state.sourceItemId) ||
    typeof state.originalItemFingerprint !== "string" ||
    Array.from(state.originalItemFingerprint).length > 600 ||
    typeof workingItem !== "object" ||
    workingItem === null ||
    Array.isArray(workingItem)
  ) {
    return undefined;
  }

  const candidate = workingItem as Record<string, unknown>;
  if (
    typeof candidate.productId !== "string" ||
    !candidate.productId.trim() ||
    typeof candidate.quantity !== "number" ||
    !Number.isSafeInteger(candidate.quantity) ||
    candidate.quantity <= 0 ||
    typeof candidate.selectedOptions !== "object" ||
    candidate.selectedOptions === null ||
    Array.isArray(candidate.selectedOptions)
  ) {
    return undefined;
  }

  const selectedOptions: Record<string, SupportedOrderFieldValue> = {};
  for (const [key, optionValue] of Object.entries(candidate.selectedOptions as Record<string, unknown>)) {
    if (!key.trim() || !["string", "number", "boolean"].includes(typeof optionValue)) return undefined;
    if (typeof optionValue === "string" && !optionValue.trim()) return undefined;
    if (typeof optionValue === "number" && !Number.isFinite(optionValue)) return undefined;
    selectedOptions[key] = optionValue as SupportedOrderFieldValue;
  }

  const awaitingTextFieldKey = typeof state.awaitingTextFieldKey === "string" && isSafeFieldKey(state.awaitingTextFieldKey)
    ? state.awaitingTextFieldKey
    : undefined;
  return {
    version: CART_ITEM_EDIT_PREVIEW_STATE_VERSION,
    kind: "EDIT_CART_ITEM_OPTIONS",
    sourceItemId: state.sourceItemId,
    originalItemFingerprint: state.originalItemFingerprint,
    workingItem: {
      productId: candidate.productId.trim(),
      quantity: candidate.quantity,
      selectedOptions,
    },
    ...(awaitingTextFieldKey ? { awaitingTextFieldKey } : {}),
  };
}

/** Recognizes only D2C canonical actions plus the exact edit save/cancel/text controls. */
export function normalizeCartItemEditAction(rawId: unknown): CartItemEditActionNormalizationResult {
  const option = normalizeItemOptionActionId(rawId);
  if (option.recognized) {
    return option.valid && option.action
      ? {
          recognized: true,
          valid: true,
          action: {
            type: "SELECT_OPTION",
            rawId: option.action.rawId,
            fieldKey: option.action.fieldKey,
            canonicalValue: option.action.canonicalValue,
          },
        }
      : { recognized: true, valid: false, failureCode: "INVALID_ITEM_OPTION_ACTION" };
  }

  if (typeof rawId !== "string" || !rawId.startsWith("cart_review_item_edit:")) {
    return { recognized: false, valid: false };
  }
  if (Array.from(rawId).length > MAX_ITEM_EDIT_ACTION_LENGTH) {
    return { recognized: true, valid: false, failureCode: "MALFORMED_ITEM_EDIT_ACTION" };
  }
  if (rawId === "cart_review_item_edit:save") {
    return { recognized: true, valid: true, action: { type: "SAVE", rawId } };
  }
  if (rawId === "cart_review_item_edit:cancel") {
    return { recognized: true, valid: true, action: { type: "CANCEL", rawId } };
  }

  const segments = rawId.split(":");
  if (segments.length !== 3 || segments[0] !== "cart_review_item_edit" || segments[1] !== "text") {
    return { recognized: true, valid: false, failureCode: "MALFORMED_ITEM_EDIT_ACTION" };
  }
  if (!isSafeFieldKey(segments[2])) {
    return { recognized: true, valid: false, failureCode: "UNSAFE_ITEM_EDIT_FIELD" };
  }
  return {
    recognized: true,
    valid: true,
    action: { type: "ENTER_TEXT", rawId, fieldKey: segments[2] },
  };
}

function operationResult(input: Omit<CartItemEditOperationResult, "warnings"> & { warnings?: string[] }): CartItemEditOperationResult {
  return {
    ...input,
    cartBefore: cloneCart(input.cartBefore),
    cartAfter: cloneCart(input.cartAfter),
    ...(input.editState ? { editState: cloneState(input.editState) } : {}),
    warnings: [...(input.warnings || [])],
  };
}

function failure(input: {
  context: CartItemEditContext;
  cartBefore: CartDraft;
  failureCode: CartItemEditFailureCode;
  editState?: CartItemEditPreviewState;
  warnings?: string[];
}): CartItemEditOperationResult {
  const readiness = inspectCartReviewReadiness({ ...input.context, cart: input.cartBefore });
  return operationResult({
    success: false,
    changed: false,
    cartBefore: input.cartBefore,
    cartAfter: input.cartBefore,
    ...(input.editState ? { editState: input.editState } : {}),
    ...(readiness.review ? { review: readiness.review } : {}),
    ...(readiness.commercialEvaluation ? { commercialEvaluation: readiness.commercialEvaluation } : {}),
    failureCode: input.failureCode,
    warnings: [...(input.warnings || []), ...readiness.warnings],
  });
}

function makeState(input: {
  source: CartItem;
  selectedOptions: Record<string, SupportedOrderFieldValue>;
  originalItemFingerprint?: string;
  awaitingTextFieldKey?: string;
}): CartItemEditPreviewState {
  return {
    version: CART_ITEM_EDIT_PREVIEW_STATE_VERSION,
    kind: "EDIT_CART_ITEM_OPTIONS",
    sourceItemId: input.source.id,
    originalItemFingerprint: input.originalItemFingerprint || itemEditFingerprint(input.source),
    workingItem: {
      productId: input.source.productId,
      quantity: input.source.quantity,
      selectedOptions: { ...input.selectedOptions },
    },
    ...(input.awaitingTextFieldKey ? { awaitingTextFieldKey: input.awaitingTextFieldKey } : {}),
  };
}

function sourceForState(cart: CartDraft, state: CartItemEditPreviewState): CartItem | undefined {
  return cart.items.find((item) => item.id === state.sourceItemId);
}

function verifyCurrentSource(input: {
  context: CartItemEditContext;
  cartBefore: CartDraft;
  state: CartItemEditPreviewState;
}): CartItem | CartItemEditOperationResult {
  if (input.cartBefore.status !== "CART_REVIEW" || input.cartBefore.currentItemDraft) {
    return failure({ context: input.context, cartBefore: input.cartBefore, editState: input.state, failureCode: "STALE_ITEM_EDIT_STATE" });
  }
  const readiness = inspectCartReviewReadiness({ ...input.context, cart: input.cartBefore });
  if (!readiness.ready) {
    return failure({ context: input.context, cartBefore: input.cartBefore, editState: input.state, failureCode: readiness.failureCode || "INVALID_REVIEW_STATE", warnings: readiness.warnings });
  }
  const source = sourceForState(input.cartBefore, input.state);
  if (!source || itemEditFingerprint(source) !== input.state.originalItemFingerprint) {
    return failure({ context: input.context, cartBefore: input.cartBefore, editState: input.state, failureCode: "STALE_ITEM_EDIT_STATE" });
  }
  return source;
}

export function startCartItemEdit(input: {
  context: CartItemEditContext;
  itemId: string;
  activeState?: CartItemEditPreviewState;
  hasCartReviewConflict?: boolean;
}): CartItemEditOperationResult {
  const cartBefore = cloneCart(input.context.cart);
  if (input.hasCartReviewConflict) {
    return failure({ context: input.context, cartBefore, failureCode: "CONFLICTING_CART_REVIEW_STATE" });
  }
  if (input.activeState) {
    if (input.activeState.sourceItemId !== input.itemId) {
      return failure({ context: input.context, cartBefore, editState: input.activeState, failureCode: "CONFLICTING_CART_REVIEW_STATE" });
    }
    const source = verifyCurrentSource({ context: input.context, cartBefore, state: input.activeState });
    if ("success" in source) return source;
    return operationResult({ success: true, changed: false, cartBefore, cartAfter: cartBefore, editState: input.activeState, warnings: [] });
  }

  const readiness = inspectCartReviewReadiness({ ...input.context, cart: cartBefore });
  if (!readiness.ready) {
    return failure({ context: input.context, cartBefore, failureCode: readiness.failureCode || "INVALID_REVIEW_STATE", warnings: readiness.warnings });
  }
  const source = cartBefore.items.find((item) => item.id === input.itemId);
  if (!source) {
    return failure({ context: input.context, cartBefore, failureCode: "UNKNOWN_CART_ITEM" });
  }
  const normalized = canonicalizeSelectedOptions({ fields: input.context.requiredFields, selectedOptions: source.selectedOptions });
  if (!normalized.valid) {
    return failure({ context: input.context, cartBefore, failureCode: "INVALID_SOURCE_ITEM_OPTIONS" });
  }
  return operationResult({
    success: true,
    changed: false,
    cartBefore,
    cartAfter: cartBefore,
    editState: makeState({ source, selectedOptions: normalized.selectedOptions }),
    review: readiness.review,
    commercialEvaluation: readiness.commercialEvaluation,
    warnings: readiness.warnings,
  });
}

function applyWorkingOption(input: {
  context: CartItemEditContext;
  state: CartItemEditPreviewState;
  optionKey: string;
  value: unknown;
  requireOpenText?: boolean;
}): CartItemEditOperationResult {
  const cartBefore = cloneCart(input.context.cart);
  const source = verifyCurrentSource({ context: input.context, cartBefore, state: input.state });
  if ("success" in source) return source;

  const fieldKey = matchingFieldKey(input.context.requiredFields, input.optionKey);
  const field = fieldKey && getItemCollectionOptionFields(input.context.requiredFields).find((candidate) => candidate.key === fieldKey);
  if (!field) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "INVALID_ITEM_OPTION" });
  }
  if (input.requireOpenText && field.options?.length) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "TEXT_FIELD_NOT_OPEN" });
  }
  const validation = validateItemCollectionOption({ fields: input.context.requiredFields, optionKey: field.key, value: input.value });
  if (!validation.valid) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: validation.failureCode });
  }

  const selectedOptions = {
    ...input.state.workingItem.selectedOptions,
    [validation.option.field.key]: validation.option.value,
  };
  const canonical = canonicalizeSelectedOptions({ fields: input.context.requiredFields, selectedOptions });
  if (!canonical.valid) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: canonical.failureCode });
  }
  const changed = input.state.workingItem.selectedOptions[validation.option.field.key] !== validation.option.value;
  return operationResult({
    success: true,
    changed,
    cartBefore,
    cartAfter: cartBefore,
    editState: makeState({
      source,
      selectedOptions: canonical.selectedOptions,
      originalItemFingerprint: input.state.originalItemFingerprint,
    }),
    warnings: [],
  });
}

export function selectCartItemEditOption(input: {
  context: CartItemEditContext;
  state: CartItemEditPreviewState;
  fieldKey: string;
  canonicalValue: string;
}): CartItemEditOperationResult {
  return applyWorkingOption({
    context: input.context,
    state: input.state,
    optionKey: input.fieldKey,
    value: input.canonicalValue,
  });
}

export function beginCartItemEditText(input: {
  context: CartItemEditContext;
  state: CartItemEditPreviewState;
  fieldKey: string;
}): CartItemEditOperationResult {
  const cartBefore = cloneCart(input.context.cart);
  const source = verifyCurrentSource({ context: input.context, cartBefore, state: input.state });
  if ("success" in source) return source;
  const fieldKey = matchingFieldKey(input.context.requiredFields, input.fieldKey);
  const field = fieldKey && getItemCollectionOptionFields(input.context.requiredFields).find((candidate) => candidate.key === fieldKey);
  if (!field) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "INVALID_ITEM_OPTION" });
  }
  if (field.options?.length) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "TEXT_FIELD_NOT_OPEN" });
  }
  return operationResult({
    success: true,
    changed: false,
    cartBefore,
    cartAfter: cartBefore,
    editState: makeState({
      source,
      selectedOptions: { ...input.state.workingItem.selectedOptions },
      originalItemFingerprint: input.state.originalItemFingerprint,
      awaitingTextFieldKey: field.key,
    }),
    warnings: [],
  });
}

export function captureCartItemEditText(input: {
  context: CartItemEditContext;
  state: CartItemEditPreviewState;
  text: unknown;
}): CartItemEditOperationResult {
  if (!input.state.awaitingTextFieldKey) {
    return failure({ context: input.context, cartBefore: cloneCart(input.context.cart), editState: input.state, failureCode: "TEXT_FIELD_NOT_AWAITED" });
  }
  const normalized = normalizeCartItemEditText(input.text);
  if (!normalized.valid) {
    return failure({ context: input.context, cartBefore: cloneCart(input.context.cart), editState: input.state, failureCode: normalized.failureCode });
  }
  return applyWorkingOption({
    context: input.context,
    state: input.state,
    optionKey: input.state.awaitingTextFieldKey,
    value: normalized.value,
    requireOpenText: true,
  });
}

export function saveCartItemEdit(input: {
  context: CartItemEditContext;
  state: CartItemEditPreviewState;
}): CartItemEditOperationResult {
  const cartBefore = cloneCart(input.context.cart);
  const source = verifyCurrentSource({ context: input.context, cartBefore, state: input.state });
  if ("success" in source) return source;
  if (input.state.awaitingTextFieldKey) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "TEXT_FIELD_NOT_AWAITED" });
  }
  if (source.productId !== input.state.workingItem.productId || source.quantity !== input.state.workingItem.quantity) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "STALE_ITEM_EDIT_STATE" });
  }
  const canonical = canonicalizeSelectedOptions({ fields: input.context.requiredFields, selectedOptions: { ...input.state.workingItem.selectedOptions } });
  if (!canonical.valid) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: canonical.failureCode });
  }
  const noChange = createItemFingerprint(source) === createItemFingerprint({ productId: source.productId, selectedOptions: canonical.selectedOptions });
  if (noChange) {
    const readiness = inspectCartReviewReadiness({ ...input.context, cart: cartBefore });
    return operationResult({
      success: Boolean(readiness.ready),
      changed: false,
      cartBefore,
      cartAfter: cartBefore,
      review: readiness.review,
      commercialEvaluation: readiness.commercialEvaluation,
      ...(readiness.ready ? {} : { failureCode: readiness.failureCode || "INVALID_REVIEW_STATE" }),
      warnings: readiness.warnings,
    });
  }

  const mutation = replaceItemOptionsAndMerge({
    cart: cartBefore,
    itemId: source.id,
    selectedOptions: canonical.selectedOptions,
  });
  if (!mutation.accepted) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "CART_MUTATION_REJECTED" });
  }
  const lifecycle = setCartStatus({ cart: mutation.cart, status: "CART_REVIEW" });
  if (!lifecycle.accepted) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "CART_MUTATION_REJECTED" });
  }
  const planningResult = synchronizeReviewTargetToCompletedUnits({ ...input.context, cart: lifecycle.cart });
  if (!planningResult.success) {
    return failure({ context: input.context, cartBefore, editState: input.state, failureCode: "PLANNING_COMMAND_REJECTED", warnings: planningResult.warnings });
  }
  const readiness = inspectCartReviewReadiness({ ...input.context, cart: planningResult.cart });
  return operationResult({
    success: Boolean(readiness.ready),
    changed: Boolean(readiness.ready),
    cartBefore,
    cartAfter: planningResult.cart,
    review: readiness.review,
    commercialEvaluation: readiness.commercialEvaluation,
    planningResult,
    ...(mutation.mergedItemId ? { mergedIntoItemId: mutation.mergedItemId } : {}),
    ...(readiness.ready ? {} : { failureCode: readiness.failureCode || "COMMERCIAL_STATE_BLOCKED" }),
    warnings: [...planningResult.warnings, ...readiness.warnings],
  });
}
