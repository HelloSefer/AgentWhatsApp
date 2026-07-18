import { randomUUID } from "node:crypto";
import type { OrderEntities } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import {
  cartStatuses,
  type CartCompatibilityInput,
  type CartCompatibilityResult,
  type CartDraft,
  type CartFieldScope,
  type CartIntegrityResult,
  type CartItem,
  type CartItemStatus,
  type CartMode,
  type CartMutationResult,
  type CartStatus,
  type SupportedOrderFieldValue,
} from "./cart-state.types";

export const CART_SCHEMA_VERSION = 1 as const;
export const MAX_CART_ITEMS = 20;
export const MAX_CART_ITEM_QUANTITY = 100;
export const MAX_CART_TARGET_ITEM_COUNT = MAX_CART_ITEM_QUANTITY;

const ORDER_FIELD_KEYS = new Set([
  "fullname",
  "name",
  "phone",
  "city",
  "address",
  "notes",
  "note",
  "deliveryaddress",
  "deliveryinstructions",
]);

const ITEM_FIELD_KEYS = new Set([
  "quantity",
  "size",
  "color",
  "variant",
  "model",
  "flavor",
  "capacity",
  "material",
]);

const ORDER_SEMANTIC_TYPES = new Set([
  "PERSON_NAME",
  "PHONE",
  "LOCATION",
  "ADDRESS",
  "DELIVERY_ADDRESS",
  "DELIVERY_INSTRUCTIONS",
  "ORDER_NOTE",
]);

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeOptionValue(value: SupportedOrderFieldValue): string {
  if (typeof value === "string") {
    return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  }

  return String(value);
}

function isSupportedValue(value: unknown): value is SupportedOrderFieldValue {
  if (typeof value === "string") {
    return Boolean(value.trim());
  }

  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function hasValue(value: unknown): boolean {
  return isSupportedValue(value);
}

function cloneItem(item: CartItem): CartItem {
  return {
    ...item,
    quantityExplicitlySet: item.quantityExplicitlySet,
    selectedOptions: { ...item.selectedOptions },
  };
}

function cloneCart(cart: CartDraft): CartDraft {
  return {
    ...cart,
    items: cart.items.map(cloneItem),
    currentItemDraft: cart.currentItemDraft
      ? cloneItem(cart.currentItemDraft)
      : undefined,
    orderLevelFields: { ...cart.orderLevelFields },
  };
}

function isValidQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_CART_ITEM_QUANTITY
  );
}

function isValidPositiveInteger(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= maximum
  );
}

function isRequiredItemField(field: RequiredOrderField): boolean {
  const requirement = field.requirement || (field.required ? "REQUIRED" : "OPTIONAL");

  return field.enabled && requirement !== "DISABLED" && requirement !== "OPTIONAL";
}

function isQuantityRequired(fields: RequiredOrderField[]): boolean {
  return fields.some(
    (field) =>
      resolveCartFieldScope(field) === "ITEM" &&
      isRequiredItemField(field) &&
      (normalizeKey(field.key) === "quantity" || field.semanticType?.trim().toUpperCase() === "QUANTITY"),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function hasAnyObjectValues(value: Record<string, unknown>): boolean {
  return Object.values(value).some(hasValue);
}

function selectCompatibilityItem(cart: CartDraft): CartItem | undefined {
  return cart.currentItemDraft || cart.items[0];
}

function isCartStatus(value: unknown): value is CartStatus {
  return typeof value === "string" && cartStatuses.includes(value as CartStatus);
}

function deriveCartStatus(input: {
  cart: CartDraft;
  legacyState?: CartCompatibilityInput["legacyState"];
}): CartStatus {
  const { cart, legacyState } = input;

  if (legacyState?.confirmed) {
    return "CONFIRMED";
  }

  if (legacyState?.awaitingConfirmation) {
    return "AWAITING_CONFIRMATION";
  }

  if (cart.currentItemDraft) {
    return "COLLECTING_ITEM";
  }

  if (cart.items.length === 0) {
    return legacyState?.orderCycleId ? "PLANNING" : "EMPTY";
  }

  return legacyState?.isComplete ? "CART_REVIEW" : "COLLECTING_DELIVERY";
}

export function resolveCartFieldScope(field: RequiredOrderField): CartFieldScope {
  const key = normalizeKey(field.key);
  const semanticType = field.semanticType?.trim().toUpperCase();

  if (field.source === "productOption") {
    return "ITEM";
  }

  if (key === "quantity" || semanticType === "QUANTITY") {
    return "ITEM";
  }

  if (ORDER_FIELD_KEYS.has(key) || (semanticType && ORDER_SEMANTIC_TYPES.has(semanticType))) {
    return "ORDER";
  }

  // Existing seller customer fields are shared by default. Unknown product options stay item-scoped above.
  return "ORDER";
}

export function createCartItem(input: {
  productId: string;
  quantity?: number;
  selectedOptions?: Record<string, SupportedOrderFieldValue>;
  status?: CartItemStatus;
  id?: string;
}): CartItem {
  return {
    id: input.id || randomUUID(),
    productId: input.productId.trim(),
    quantity: input.quantity ?? 1,
    quantityExplicitlySet: input.quantity !== undefined,
    selectedOptions: { ...(input.selectedOptions || {}) },
    status: input.status || "DRAFT",
  };
}

export function initializeCart(mode: CartMode = "STANDARD"): CartDraft {
  return {
    schemaVersion: CART_SCHEMA_VERSION,
    mode,
    status: "EMPTY",
    items: [],
    orderLevelFields: {},
  };
}

export function createItemFingerprint(item: Pick<CartItem, "productId" | "selectedOptions">): string {
  const options = Object.entries(item.selectedOptions)
    .map(([key, value]) => [normalizeKey(key), normalizeOptionValue(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    );

  return `${item.productId.trim()}::${JSON.stringify(options)}`;
}

export function areCartItemsMergeCompatible(left: CartItem, right: CartItem): boolean {
  return (
    left.status === "COMPLETE" &&
    right.status === "COMPLETE" &&
    createItemFingerprint(left) === createItemFingerprint(right)
  );
}

export function getItemRequiredOptionKeys(fields: RequiredOrderField[]): string[] {
  return fields
    .filter(
      (field) =>
        resolveCartFieldScope(field) === "ITEM" &&
        isRequiredItemField(field) &&
        normalizeKey(field.key) !== "quantity" &&
        field.semanticType?.trim().toUpperCase() !== "QUANTITY",
    )
    .map((field) => field.key);
}

function validateCurrentItemCompleteness(input: {
  item: CartItem;
  fields: RequiredOrderField[];
}): string[] {
  const invalidPaths: string[] = [];

  if (!input.item.productId.trim()) {
    invalidPaths.push("currentItemDraft.productId");
  }

  if (!isValidQuantity(input.item.quantity)) {
    invalidPaths.push("currentItemDraft.quantity");
  }

  const quantityRequired = isQuantityRequired(input.fields);
  if (quantityRequired && !input.item.quantityExplicitlySet) {
    invalidPaths.push("currentItemDraft.quantity_not_collected");
  }

  for (const key of getItemRequiredOptionKeys(input.fields)) {
    if (!hasValue(input.item.selectedOptions[key])) {
      invalidPaths.push(`currentItemDraft.selectedOptions.${key}`);
    }
  }

  return invalidPaths;
}

export function evaluateCartIntegrity(input: {
  cart: CartDraft;
  fields?: RequiredOrderField[];
}): CartIntegrityResult {
  const invalidPaths: string[] = [];
  const warnings: string[] = [];
  const { cart, fields = [] } = input;

  if (cart.schemaVersion !== CART_SCHEMA_VERSION) {
    invalidPaths.push("schemaVersion");
  }

  if (!isCartStatus(cart.status)) {
    invalidPaths.push("status");
  }

  if (!Array.isArray(cart.items) || cart.items.length > MAX_CART_ITEMS) {
    invalidPaths.push("items");
  }

  if (cart.targetItemCount !== undefined && !isValidPositiveInteger(cart.targetItemCount, MAX_CART_TARGET_ITEM_COUNT)) {
    invalidPaths.push("targetItemCount");
  }

  const itemIds = new Set<string>();
  const itemFingerprints = new Set<string>();
  const orderFieldKeys = new Set(
    fields
      .filter((field) => resolveCartFieldScope(field) === "ORDER")
      .map((field) => normalizeKey(field.key)),
  );
  const itemFieldKeys = new Set(
    fields
      .filter((field) => resolveCartFieldScope(field) === "ITEM")
      .map((field) => normalizeKey(field.key)),
  );

  const validateItem = (item: CartItem, path: string, expectedStatus?: CartItemStatus) => {
    if (!item || typeof item !== "object") {
      invalidPaths.push(path);
      return;
    }

    if (!item.id?.trim()) {
      invalidPaths.push(`${path}.id`);
    } else if (itemIds.has(item.id)) {
      invalidPaths.push(`${path}.id_duplicate`);
    } else {
      itemIds.add(item.id);
    }

    if (!item.productId?.trim()) {
      invalidPaths.push(`${path}.productId`);
    }

    if (!isValidQuantity(item.quantity)) {
      invalidPaths.push(`${path}.quantity`);
    }

    if (!item.selectedOptions || Array.isArray(item.selectedOptions) || typeof item.selectedOptions !== "object") {
      invalidPaths.push(`${path}.selectedOptions`);
    } else {
      for (const [key, value] of Object.entries(item.selectedOptions)) {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) {
          invalidPaths.push(`${path}.selectedOptions.${key || "<empty>"}`);
        }
        if (!isSupportedValue(value)) {
          invalidPaths.push(`${path}.selectedOptions.${key}`);
        }
        if (orderFieldKeys.has(normalizedKey)) {
          invalidPaths.push(`${path}.selectedOptions.${key}_order_scoped`);
        }
      }
    }

    if (expectedStatus && item.status !== expectedStatus) {
      invalidPaths.push(`${path}.status`);
    }
  };

  cart.items.forEach((item, index) => {
    validateItem(item, `items.${index}`, "COMPLETE");
    const fingerprint = createItemFingerprint(item);
    if (itemFingerprints.has(fingerprint)) {
      invalidPaths.push(`items.${index}.duplicate_identity`);
    } else {
      itemFingerprints.add(fingerprint);
    }
  });

  if (cart.currentItemDraft) {
    const currentItemIdExistsInItems = itemIds.has(cart.currentItemDraft.id);
    validateItem(cart.currentItemDraft, "currentItemDraft", "DRAFT");
    if (currentItemIdExistsInItems) {
      invalidPaths.push("currentItemDraft.id_in_items");
    }
  }

  if (!cart.orderLevelFields || Array.isArray(cart.orderLevelFields) || typeof cart.orderLevelFields !== "object") {
    invalidPaths.push("orderLevelFields");
  } else {
    for (const [key, value] of Object.entries(cart.orderLevelFields)) {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey || !isSupportedValue(value)) {
        invalidPaths.push(`orderLevelFields.${key || "<empty>"}`);
      }
      if (itemFieldKeys.has(normalizedKey)) {
        invalidPaths.push(`orderLevelFields.${key}_item_scoped`);
      }
    }
  }

  if (cart.status === "CONFIRMED") {
    if (cart.currentItemDraft) {
      invalidPaths.push("confirmed.currentItemDraft");
    }
    if (cart.items.length === 0) {
      invalidPaths.push("confirmed.items");
    }
  }

  if (cart.status === "AWAITING_CONFIRMATION" && (cart.currentItemDraft || cart.items.length === 0)) {
    invalidPaths.push("awaitingConfirmation.items");
  }

  if (cart.items.length === 0 && ["CART_REVIEW", "AWAITING_CONFIRMATION", "CONFIRMED"].includes(cart.status)) {
    invalidPaths.push("confirmable.items");
  }

  if (cart.items.length > 1 && !cart.targetItemCount) {
    warnings.push("targetItemCount_not_set");
  }

  return {
    valid: invalidPaths.length === 0,
    invalidPaths,
    warnings,
  };
}

export function startCurrentItem(input: {
  cart: CartDraft;
  productId: string;
}): CartMutationResult {
  if (input.cart.currentItemDraft) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths: ["currentItemDraft"] };
  }

  if (!input.productId.trim()) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths: ["productId"] };
  }

  const cart = cloneCart(input.cart);
  cart.currentItemDraft = createCartItem({ productId: input.productId, status: "DRAFT" });
  cart.status = "COLLECTING_ITEM";

  return { cart, accepted: true };
}

export function setCurrentItemOption(input: {
  cart: CartDraft;
  productId: string;
  optionKey: string;
  value: SupportedOrderFieldValue;
}): CartMutationResult {
  const start = input.cart.currentItemDraft
    ? { cart: cloneCart(input.cart), accepted: true }
    : startCurrentItem({ cart: input.cart, productId: input.productId });

  if (!start.accepted || !start.cart.currentItemDraft) {
    return start;
  }

  if (!normalizeKey(input.optionKey) || !isSupportedValue(input.value)) {
    return { cart: start.cart, accepted: false, invalidPaths: ["currentItemDraft.selectedOptions"] };
  }

  start.cart.currentItemDraft.selectedOptions[input.optionKey] = input.value;
  start.cart.status = "COLLECTING_ITEM";

  return start;
}

export function setCurrentItemQuantity(input: {
  cart: CartDraft;
  productId: string;
  quantity: number;
}): CartMutationResult {
  const start = input.cart.currentItemDraft
    ? { cart: cloneCart(input.cart), accepted: true }
    : startCurrentItem({ cart: input.cart, productId: input.productId });

  if (!start.accepted || !start.cart.currentItemDraft) {
    return start;
  }

  if (!isValidQuantity(input.quantity)) {
    return { cart: start.cart, accepted: false, invalidPaths: ["currentItemDraft.quantity"] };
  }

  start.cart.currentItemDraft.quantity = input.quantity;
  start.cart.currentItemDraft.quantityExplicitlySet = true;
  start.cart.status = "COLLECTING_ITEM";

  return start;
}

export function addItem(input: {
  cart: CartDraft;
  item: CartItem;
}): CartMutationResult {
  const cart = cloneCart(input.cart);
  const candidate = cloneItem({ ...input.item, status: "COMPLETE" });
  const candidateIntegrity = evaluateCartIntegrity({
    cart: { ...cart, items: [...cart.items, candidate] },
  });

  const nonDuplicatePaths = candidateIntegrity.invalidPaths.filter(
    (path) => !path.includes("duplicate_identity"),
  );
  if (nonDuplicatePaths.length > 0 || cart.items.length >= MAX_CART_ITEMS) {
    return { cart, accepted: false, invalidPaths: nonDuplicatePaths.length > 0 ? nonDuplicatePaths : ["items"] };
  }

  const compatible = cart.items.find((item) => areCartItemsMergeCompatible(item, candidate));
  if (compatible) {
    const quantity = compatible.quantity + candidate.quantity;
    if (!isValidQuantity(quantity)) {
      return { cart, accepted: false, invalidPaths: ["items.quantity"] };
    }
    compatible.quantity = quantity;
    return { cart, accepted: true, mergedItemId: compatible.id };
  }

  cart.items.push(candidate);
  return { cart, accepted: true };
}

export function finalizeCurrentItem(input: {
  cart: CartDraft;
  fields: RequiredOrderField[];
}): CartMutationResult {
  if (!input.cart.currentItemDraft) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths: ["currentItemDraft"] };
  }

  const draft = cloneItem(input.cart.currentItemDraft);
  const invalidPaths = validateCurrentItemCompleteness({ item: draft, fields: input.fields });
  if (invalidPaths.length > 0) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths };
  }

  const addResult = addItem({
    cart: { ...cloneCart(input.cart), currentItemDraft: undefined },
    item: { ...draft, status: "COMPLETE" },
  });
  if (!addResult.accepted) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths: addResult.invalidPaths };
  }

  addResult.cart.currentItemDraft = undefined;
  addResult.cart.status = "COLLECTING_DELIVERY";
  return addResult;
}

export function updateItem(input: {
  cart: CartDraft;
  itemId: string;
  quantity?: number;
  selectedOptions?: Record<string, SupportedOrderFieldValue>;
}): CartMutationResult {
  const cart = cloneCart(input.cart);
  const item = cart.items.find((candidate) => candidate.id === input.itemId);
  if (!item) {
    return { cart, accepted: false, invalidPaths: ["itemId"] };
  }

  if (input.quantity !== undefined && !isValidQuantity(input.quantity)) {
    return { cart, accepted: false, invalidPaths: ["items.quantity"] };
  }

  if (input.selectedOptions) {
    for (const [key, value] of Object.entries(input.selectedOptions)) {
      if (!normalizeKey(key) || !isSupportedValue(value)) {
        return { cart, accepted: false, invalidPaths: ["items.selectedOptions"] };
      }
    }
    item.selectedOptions = { ...input.selectedOptions };
  }
  if (input.quantity !== undefined) {
    item.quantity = input.quantity;
    item.quantityExplicitlySet = true;
  }

  return { cart, accepted: true };
}

/**
 * Replaces one completed item's option map as a single cart-boundary mutation.
 * If the replacement becomes compatible with an existing completed line, that
 * existing line remains authoritative and receives the source quantity.
 */
export function replaceItemOptionsAndMerge(input: {
  cart: CartDraft;
  itemId: string;
  selectedOptions: Record<string, SupportedOrderFieldValue>;
}): CartMutationResult {
  const cartBefore = cloneCart(input.cart);
  const source = cartBefore.items.find((item) => item.id === input.itemId);
  if (!source) {
    return { cart: cartBefore, accepted: false, invalidPaths: ["itemId"] };
  }

  const replacement = updateItem({
    cart: cartBefore,
    itemId: input.itemId,
    selectedOptions: input.selectedOptions,
  });
  if (!replacement.accepted) {
    return replacement;
  }

  const replacedSource = replacement.cart.items.find((item) => item.id === input.itemId);
  if (!replacedSource) {
    return { cart: cartBefore, accepted: false, invalidPaths: ["itemId"] };
  }

  const destination = replacement.cart.items.find(
    (item) => item.id !== replacedSource.id && areCartItemsMergeCompatible(item, replacedSource),
  );
  if (!destination) {
    return { cart: replacement.cart, accepted: true };
  }

  const quantity = destination.quantity + replacedSource.quantity;
  if (!isValidQuantity(quantity)) {
    return { cart: cartBefore, accepted: false, invalidPaths: ["items.quantity"] };
  }

  destination.quantity = quantity;
  destination.quantityExplicitlySet = destination.quantityExplicitlySet || replacedSource.quantityExplicitlySet;
  replacement.cart.items = replacement.cart.items.filter((item) => item.id !== replacedSource.id);
  return { cart: replacement.cart, accepted: true, mergedItemId: destination.id };
}

export function removeItem(input: { cart: CartDraft; itemId: string }): CartMutationResult {
  const cart = cloneCart(input.cart);
  const previousLength = cart.items.length;
  cart.items = cart.items.filter((item) => item.id !== input.itemId);
  if (cart.items.length === previousLength) {
    return { cart, accepted: false, invalidPaths: ["itemId"] };
  }
  cart.status = deriveCartStatus({ cart });
  return { cart, accepted: true };
}

/**
 * Generic planning metadata mutation. Lifecycle and offer policy intentionally
 * live above this cart boundary in the planning domain.
 */
export function setCartPlanning(input: {
  cart: CartDraft;
  mode: CartMode;
  targetItemCount: number;
  selectedOfferId?: string;
}): CartMutationResult {
  if (!isValidPositiveInteger(input.targetItemCount, MAX_CART_TARGET_ITEM_COUNT)) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths: ["targetItemCount"] };
  }

  const selectedOfferId = input.selectedOfferId?.trim();
  if (input.mode === "OFFER" && !selectedOfferId) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths: ["selectedOfferId"] };
  }

  if (input.mode === "STANDARD" && selectedOfferId) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths: ["selectedOfferId"] };
  }

  const cart = cloneCart(input.cart);
  cart.mode = input.mode;
  cart.targetItemCount = input.targetItemCount;
  if (selectedOfferId) {
    cart.selectedOfferId = selectedOfferId;
  } else {
    delete cart.selectedOfferId;
  }

  if (cart.items.length === 0 && !cart.currentItemDraft) {
    cart.status = "PLANNING";
  }

  return { cart, accepted: true };
}

/** Clears only planning metadata; it never removes items or drafts. */
export function clearCartPlanning(input: { cart: CartDraft }): CartMutationResult {
  const cart = cloneCart(input.cart);
  cart.mode = "STANDARD";
  delete cart.targetItemCount;
  delete cart.selectedOfferId;

  if (cart.items.length === 0 && !cart.currentItemDraft) {
    cart.status = "EMPTY";
  }

  return { cart, accepted: true };
}

export function mergeCompatibleItems(cart: CartDraft): CartMutationResult {
  const next = cloneCart(cart);
  const merged: CartItem[] = [];

  for (const item of next.items) {
    const compatible = merged.find((candidate) => areCartItemsMergeCompatible(candidate, item));
    if (!compatible) {
      merged.push(cloneItem(item));
      continue;
    }

    const quantity = compatible.quantity + item.quantity;
    if (!isValidQuantity(quantity)) {
      return { cart: cloneCart(cart), accepted: false, invalidPaths: ["items.quantity"] };
    }
    compatible.quantity = quantity;
  }

  next.items = merged;
  return { cart: next, accepted: true };
}

export function setOrderLevelField(input: {
  cart: CartDraft;
  fieldKey: string;
  value: SupportedOrderFieldValue;
}): CartMutationResult {
  const cart = cloneCart(input.cart);
  if (!normalizeKey(input.fieldKey) || !isSupportedValue(input.value)) {
    return { cart, accepted: false, invalidPaths: ["orderLevelFields"] };
  }
  cart.orderLevelFields[input.fieldKey] = input.value;
  return { cart, accepted: true };
}

export function setTargetItemCount(input: {
  cart: CartDraft;
  targetItemCount?: number;
}): CartMutationResult {
  const cart = cloneCart(input.cart);
  if (input.targetItemCount !== undefined && !isValidPositiveInteger(input.targetItemCount, MAX_CART_ITEMS)) {
    return { cart, accepted: false, invalidPaths: ["targetItemCount"] };
  }
  cart.targetItemCount = input.targetItemCount;
  return { cart, accepted: true };
}

export function setCartStatus(input: {
  cart: CartDraft;
  status: CartStatus;
}): CartMutationResult {
  if (!isCartStatus(input.status)) {
    return { cart: cloneCart(input.cart), accepted: false, invalidPaths: ["status"] };
  }
  return { cart: { ...cloneCart(input.cart), status: input.status }, accepted: true };
}

export function projectSingleItemCompatibility(cart: CartDraft): Record<string, SupportedOrderFieldValue> {
  const item = selectCompatibilityItem(cart);
  return {
    ...cart.orderLevelFields,
    ...(item?.selectedOptions || {}),
    ...(item?.quantityExplicitlySet
      ? { quantity: item.quantity }
      : {}),
  };
}

function applyLegacyValuesToCart(input: {
  cart: CartDraft;
  legacyCollected: Record<string, unknown>;
  productId?: string;
  fields: RequiredOrderField[];
  legacyState: CartCompatibilityInput["legacyState"];
}): CartDraft {
  const cart = cloneCart(input.cart);
  const itemOptions: Record<string, SupportedOrderFieldValue> = {};
  const orderLevelFields: Record<string, SupportedOrderFieldValue> = {};
  let quantity: number | undefined;

  const fieldsByKey = new Map(input.fields.map((field) => [field.key, field]));
  for (const [key, rawValue] of Object.entries(input.legacyCollected)) {
    if (!isSupportedValue(rawValue)) {
      continue;
    }
    const field = fieldsByKey.get(key);
    const inferredScope = field
      ? resolveCartFieldScope(field)
      : ITEM_FIELD_KEYS.has(normalizeKey(key))
        ? "ITEM"
        : "ORDER";

    if (inferredScope === "ITEM") {
      if (normalizeKey(key) === "quantity") {
        if (isValidQuantity(rawValue)) {
          quantity = rawValue;
        }
      } else {
        itemOptions[key] = rawValue;
      }
    } else {
      orderLevelFields[key] = rawValue;
    }
  }

  cart.orderLevelFields = {
    ...cart.orderLevelFields,
    ...orderLevelFields,
  };

  const hasConfiguredItemFields = input.fields.some(
    (field) => resolveCartFieldScope(field) === "ITEM",
  );
  const legacyOrderIsReady =
    input.legacyState.isComplete ||
    input.legacyState.awaitingConfirmation ||
    input.legacyState.confirmed;
  const shouldCreateCompletedOptionlessItem =
    !hasConfiguredItemFields &&
    legacyOrderIsReady &&
    hasAnyObjectValues(orderLevelFields);
  const hasItemData =
    Object.keys(itemOptions).length > 0 ||
    quantity !== undefined ||
    shouldCreateCompletedOptionlessItem;
  if (!hasItemData) {
    return cart;
  }

  const selected = selectCompatibilityItem(cart);
  const item = selected
    ? cloneItem(selected)
    : createCartItem({ productId: input.productId || "legacy-product", status: "DRAFT" });
  item.productId = item.productId.trim() || input.productId?.trim() || "legacy-product";
  item.selectedOptions = { ...item.selectedOptions, ...itemOptions };
  if (quantity !== undefined) {
    item.quantity = quantity;
    item.quantityExplicitlySet = true;
  }

  const requiredItemFields = getItemRequiredOptionKeys(input.fields);
  const itemComplete =
    isValidQuantity(item.quantity) &&
    Boolean(item.productId.trim()) &&
    (!isQuantityRequired(input.fields) || item.quantityExplicitlySet === true) &&
    requiredItemFields.every((key) => hasValue(item.selectedOptions[key]));

  if (itemComplete) {
    item.status = "COMPLETE";
    if (cart.currentItemDraft?.id === item.id) {
      cart.currentItemDraft = undefined;
    }
    const itemIndex = cart.items.findIndex((candidate) => candidate.id === item.id);
    if (itemIndex >= 0) {
      cart.items[itemIndex] = item;
    } else if (cart.items.length === 0) {
      cart.items.push(item);
    }
  } else {
    item.status = "DRAFT";
    if (cart.items.length > 0 && cart.items[0].id === item.id) {
      cart.items[0] = { ...item, status: "COMPLETE" };
    } else {
      cart.currentItemDraft = item;
    }
  }

  return cart;
}

export function reconcileLegacyOrderStateWithCart(input: CartCompatibilityInput): CartCompatibilityResult {
  const existingCart = input.cart && input.cart.schemaVersion === CART_SCHEMA_VERSION
    ? cloneCart(input.cart)
    : initializeCart();
  const legacyHasData = hasAnyObjectValues(input.legacyCollected);
  const shouldReset = !input.legacyState.orderCycleId && !legacyHasData && !input.legacyState.confirmed;
  const baseCart = shouldReset ? initializeCart(existingCart.mode) : existingCart;
  const cart = applyLegacyValuesToCart({
    cart: baseCart,
    legacyCollected: input.legacyCollected,
    productId: input.productId,
    fields: input.fields,
    legacyState: input.legacyState,
  });

  cart.status = deriveCartStatus({ cart, legacyState: input.legacyState });
  const integrity = evaluateCartIntegrity({ cart, fields: input.fields });
  const collected = projectSingleItemCompatibility(cart);
  const migrated = !input.cart || input.cart.schemaVersion !== CART_SCHEMA_VERSION;
  const changed =
    migrated ||
    stableJson(input.cart) !== stableJson(cart) ||
    stableJson(input.legacyCollected) !== stableJson(collected);

  return { cart, collected, integrity, migrated, changed };
}

export function asLegacyOrderEntities(
  values: Record<string, SupportedOrderFieldValue>,
): OrderEntities {
  return values as OrderEntities;
}
