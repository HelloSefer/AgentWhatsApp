import {
  evaluateCartIntegrity,
  finalizeCurrentItem as finalizeCartCurrentItem,
  setCartStatus,
  setCurrentItemOption as setCartCurrentItemOption,
  setCurrentItemQuantity as setCartCurrentItemQuantity,
  startCurrentItem,
  MAX_CART_ITEM_QUANTITY,
  MAX_CART_TARGET_ITEM_COUNT,
} from "../cart-state.service";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";
import {
  getRequiredItemCollectionFields,
  validateItemCollectionOption,
} from "./item-collection-requirements.service";
import type {
  ItemCollectionCommandInput,
  ItemCollectionCommandResult,
  ItemCollectionContext,
  ItemCollectionFailureCode,
  ItemCollectionInspection,
  ItemCollectionProgress,
  SetCurrentItemOptionInput,
  SetCurrentItemQuantityInput,
} from "./item-collection.types";

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

function isPositiveTarget(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0 && value <= MAX_CART_TARGET_ITEM_COUNT;
}

function isSafeItemQuantity(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0 && value <= MAX_CART_ITEM_QUANTITY;
}

function completedUnits(cart: CartDraft): number {
  return cart.items.reduce((total, item) => total + item.quantity, 0);
}

function progressFor(cart: CartDraft): ItemCollectionProgress {
  const targetUnits = isPositiveTarget(cart.targetItemCount) ? cart.targetItemCount : 0;
  const complete = completedUnits(cart);
  const remainingUnits = Math.max(0, targetUnits - complete);

  return {
    targetUnits,
    completedUnits: complete,
    remainingUnits,
    ...(cart.currentItemDraft ? { currentItemNumber: cart.items.length + 1 } : {}),
  };
}

function isUnsafeLifecycleStatus(status: CartDraft["status"]): boolean {
  return [
    "CART_REVIEW",
    "COLLECTING_DELIVERY",
    "AWAITING_CONFIRMATION",
    "CONFIRMED",
    "CANCELLED",
  ].includes(status);
}

function getContextFailure(input: ItemCollectionContext & { cart: CartDraft }): ItemCollectionFailureCode | undefined {
  if (!input.sellerId.trim() || input.sellerId !== input.productContext.sellerId || !input.productContext.productId.trim()) {
    return "INVALID_PRODUCT_CONTEXT";
  }

  if (input.cart.mode !== "STANDARD" && input.cart.mode !== "OFFER") {
    return "INVALID_CART";
  }

  if (input.cart.items.some((item) => item.productId !== input.productContext.productId) || input.cart.currentItemDraft?.productId !== undefined && input.cart.currentItemDraft.productId !== input.productContext.productId) {
    return "PRODUCT_MISMATCH";
  }

  return undefined;
}

function result(input: {
  cart: CartDraft;
  context: ItemCollectionContext;
  success: boolean;
  changed: boolean;
  nextStep?: ItemCollectionCommandResult["nextStep"];
  missingItemFields?: string[];
  invalidItemFields?: string[];
  failureCode?: ItemCollectionFailureCode;
  warnings?: string[];
}): ItemCollectionCommandResult {
  return {
    success: input.success,
    changed: input.changed,
    cart: cloneCart(input.cart),
    progress: progressFor(input.cart),
    requiredItemFields: getRequiredItemCollectionFields(input.context.requiredFields),
    ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    ...(input.missingItemFields?.length ? { missingItemFields: [...input.missingItemFields] } : {}),
    ...(input.invalidItemFields?.length ? { invalidItemFields: [...input.invalidItemFields] } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    warnings: [...(input.warnings || [])],
  };
}

function blockedResult(input: ItemCollectionCommandInput, failureCode: ItemCollectionFailureCode): ItemCollectionCommandResult {
  return result({ cart: input.cart, context: input, success: false, changed: false, failureCode });
}

function getMissingItemFields(input: ItemCollectionCommandInput): string[] {
  const draft = input.cart.currentItemDraft;
  if (!draft) {
    return [];
  }

  return getRequiredItemCollectionFields(input.requiredFields)
    .filter((field) => {
      const value = draft.selectedOptions[field.key];
      return value === undefined || value === null || (typeof value === "string" && !value.trim());
    })
    .map((field) => field.key);
}

function getInvalidCurrentItemFields(input: ItemCollectionCommandInput): string[] {
  const draft = input.cart.currentItemDraft;
  if (!draft) {
    return [];
  }

  const invalid: string[] = [];
  for (const [key, value] of Object.entries(draft.selectedOptions)) {
    const validation = validateItemCollectionOption({ fields: input.requiredFields, optionKey: key, value });
    if (!validation.valid) {
      invalid.push(key);
    }
  }
  return invalid;
}

/** Read-only item collection readiness and quantity progress inspection. */
export function inspectItemCollectionState(input: ItemCollectionCommandInput): ItemCollectionInspection {
  const progress = progressFor(input.cart);
  const failureCode = getContextFailure(input);
  if (failureCode) {
    return {
      valid: false,
      progress,
      requiredItemFields: getRequiredItemCollectionFields(input.requiredFields),
      failureCode,
      warnings: [],
    };
  }

  if (input.cart.targetItemCount === undefined) {
    return { valid: false, progress, requiredItemFields: getRequiredItemCollectionFields(input.requiredFields), failureCode: "MISSING_TARGET_ITEM_COUNT", warnings: [] };
  }
  if (!isPositiveTarget(input.cart.targetItemCount)) {
    return { valid: false, progress, requiredItemFields: getRequiredItemCollectionFields(input.requiredFields), failureCode: "INVALID_TARGET_ITEM_COUNT", warnings: [] };
  }
  if (progress.completedUnits > progress.targetUnits) {
    return { valid: false, progress, requiredItemFields: getRequiredItemCollectionFields(input.requiredFields), failureCode: "TARGET_OVERFILLED", warnings: [] };
  }

  const integrity = evaluateCartIntegrity({
    cart: input.cart,
    fields: input.requiredFields,
  });
  if (!integrity.valid) {
    return { valid: false, progress, requiredItemFields: getRequiredItemCollectionFields(input.requiredFields), failureCode: "INVALID_CART", warnings: integrity.warnings };
  }

  return {
    valid: true,
    progress,
    requiredItemFields: getRequiredItemCollectionFields(input.requiredFields),
    warnings: [],
  };
}

/** Creates a single current item draft from trusted planning state. */
export function startItemCollection(input: ItemCollectionCommandInput): ItemCollectionCommandResult {
  if (isUnsafeLifecycleStatus(input.cart.status)) {
    return blockedResult(input, "UNSAFE_CART_STATE");
  }
  const inspection = inspectItemCollectionState(input);
  if (!inspection.valid) {
    return blockedResult(input, inspection.failureCode!);
  }
  if (inspection.progress.remainingUnits === 0) {
    return blockedResult(input, "TARGET_ALREADY_FULFILLED");
  }
  if (input.cart.currentItemDraft) {
    return result({ cart: input.cart, context: input, success: true, changed: false, nextStep: "COLLECT_CURRENT_ITEM" });
  }
  if (!["PLANNING", "COLLECTING_ITEM"].includes(input.cart.status)) {
    return blockedResult(input, "UNSAFE_CART_STATE");
  }

  const mutation = startCurrentItem({ cart: input.cart, productId: input.productContext.productId });
  return mutation.accepted
    ? result({ cart: mutation.cart, context: input, success: true, changed: true, nextStep: "COLLECT_CURRENT_ITEM" })
    : result({ cart: mutation.cart, context: input, success: false, changed: false, failureCode: "CART_MUTATION_REJECTED", invalidItemFields: mutation.invalidPaths });
}

/** Sets one configured item option on the isolated current draft. */
export function setCurrentItemCollectionOption(input: SetCurrentItemOptionInput): ItemCollectionCommandResult {
  if (isUnsafeLifecycleStatus(input.cart.status)) return blockedResult(input, "UNSAFE_CART_STATE");
  const inspection = inspectItemCollectionState(input);
  if (!inspection.valid) return blockedResult(input, inspection.failureCode!);
  if (!input.cart.currentItemDraft) return blockedResult(input, "CURRENT_ITEM_MISSING");
  if (inspection.progress.remainingUnits === 0) return blockedResult(input, "TARGET_ALREADY_FULFILLED");

  const validation = validateItemCollectionOption({ fields: input.requiredFields, optionKey: input.optionKey, value: input.value });
  if (!validation.valid) {
    return result({ cart: input.cart, context: input, success: false, changed: false, failureCode: validation.failureCode, invalidItemFields: [input.optionKey] });
  }

  const currentValue = input.cart.currentItemDraft.selectedOptions[validation.option.field.key];
  if (currentValue === validation.option.value) {
    return result({ cart: input.cart, context: input, success: true, changed: false, nextStep: "COLLECT_CURRENT_ITEM" });
  }

  const mutation = setCartCurrentItemOption({
    cart: input.cart,
    productId: input.productContext.productId,
    optionKey: validation.option.field.key,
    value: validation.option.value,
  });
  return mutation.accepted
    ? result({ cart: mutation.cart, context: input, success: true, changed: true, nextStep: "COLLECT_CURRENT_ITEM" })
    : result({ cart: mutation.cart, context: input, success: false, changed: false, failureCode: "CART_MUTATION_REJECTED", invalidItemFields: mutation.invalidPaths });
}

/** Sets an explicit quantity without allowing the planned unit target to be exceeded. */
export function setCurrentItemCollectionQuantity(input: SetCurrentItemQuantityInput): ItemCollectionCommandResult {
  if (isUnsafeLifecycleStatus(input.cart.status)) return blockedResult(input, "UNSAFE_CART_STATE");
  const inspection = inspectItemCollectionState(input);
  if (!inspection.valid) return blockedResult(input, inspection.failureCode!);
  if (!input.cart.currentItemDraft) return blockedResult(input, "CURRENT_ITEM_MISSING");
  if (!isSafeItemQuantity(input.quantity)) return blockedResult(input, "INVALID_ITEM_QUANTITY");
  if (input.quantity > inspection.progress.remainingUnits) return blockedResult(input, "QUANTITY_EXCEEDS_REMAINING_TARGET");

  if (input.cart.currentItemDraft.quantity === input.quantity && input.cart.currentItemDraft.quantityExplicitlySet) {
    return result({ cart: input.cart, context: input, success: true, changed: false, nextStep: "COLLECT_CURRENT_ITEM" });
  }

  const mutation = setCartCurrentItemQuantity({ cart: input.cart, productId: input.productContext.productId, quantity: input.quantity });
  return mutation.accepted
    ? result({ cart: mutation.cart, context: input, success: true, changed: true, nextStep: "COLLECT_CURRENT_ITEM" })
    : result({ cart: mutation.cart, context: input, success: false, changed: false, failureCode: "CART_MUTATION_REJECTED", invalidItemFields: mutation.invalidPaths });
}

/** Finalizes a complete current draft and either awaits another item or marks review readiness. */
export function finalizeCurrentItemCollection(input: ItemCollectionCommandInput): ItemCollectionCommandResult {
  if (isUnsafeLifecycleStatus(input.cart.status)) return blockedResult(input, "UNSAFE_CART_STATE");
  const inspection = inspectItemCollectionState(input);
  if (!inspection.valid) return blockedResult(input, inspection.failureCode!);
  if (!input.cart.currentItemDraft) return blockedResult(input, "CURRENT_ITEM_MISSING");
  if (inspection.progress.remainingUnits === 0) return blockedResult(input, "TARGET_ALREADY_FULFILLED");

  const missingItemFields = getMissingItemFields(input);
  const invalidItemFields = getInvalidCurrentItemFields(input);
  const draft = input.cart.currentItemDraft;
  if (!isSafeItemQuantity(draft.quantity) || draft.quantity > inspection.progress.remainingUnits) {
    return result({ cart: input.cart, context: input, success: false, changed: false, failureCode: draft.quantity > inspection.progress.remainingUnits ? "QUANTITY_EXCEEDS_REMAINING_TARGET" : "INVALID_ITEM_QUANTITY", missingItemFields, invalidItemFields });
  }
  if (missingItemFields.length || invalidItemFields.length) {
    return result({ cart: input.cart, context: input, success: false, changed: false, failureCode: "MISSING_REQUIRED_ITEM_FIELDS", missingItemFields, invalidItemFields });
  }

  const mutation = finalizeCartCurrentItem({ cart: input.cart, fields: input.requiredFields });
  if (!mutation.accepted) {
    return result({ cart: mutation.cart, context: input, success: false, changed: false, failureCode: "CART_MUTATION_REJECTED", invalidItemFields: mutation.invalidPaths });
  }

  const nextProgress = progressFor(mutation.cart);
  const targetFulfilled = nextProgress.remainingUnits === 0;
  const lifecycle = setCartStatus({
    cart: mutation.cart,
    status: targetFulfilled ? "CART_REVIEW" : "COLLECTING_ITEM",
  });
  if (!lifecycle.accepted) {
    return result({ cart: mutation.cart, context: input, success: false, changed: false, failureCode: "CART_MUTATION_REJECTED", invalidItemFields: lifecycle.invalidPaths });
  }

  return result({
    cart: lifecycle.cart,
    context: input,
    success: true,
    changed: true,
    nextStep: targetFulfilled ? "CART_REVIEW_READY" : "START_NEXT_ITEM",
  });
}

/** Starts exactly one next draft when planned units remain, or marks cart review readiness. */
export function startNextItemCollection(input: ItemCollectionCommandInput): ItemCollectionCommandResult {
  if (isUnsafeLifecycleStatus(input.cart.status) && input.cart.status !== "CART_REVIEW") {
    return blockedResult(input, "UNSAFE_CART_STATE");
  }
  if (input.cart.status === "CART_REVIEW") {
    return blockedResult(input, "UNSAFE_CART_STATE");
  }
  const inspection = inspectItemCollectionState(input);
  if (!inspection.valid) return blockedResult(input, inspection.failureCode!);
  if (input.cart.currentItemDraft) {
    return result({ cart: input.cart, context: input, success: true, changed: false, nextStep: "COLLECT_CURRENT_ITEM" });
  }
  if (inspection.progress.remainingUnits === 0) {
    const lifecycle = setCartStatus({ cart: input.cart, status: "CART_REVIEW" });
    return lifecycle.accepted
      ? result({ cart: lifecycle.cart, context: input, success: true, changed: lifecycle.cart.status !== input.cart.status, nextStep: "CART_REVIEW_READY" })
      : result({ cart: input.cart, context: input, success: false, changed: false, failureCode: "CART_MUTATION_REJECTED", invalidItemFields: lifecycle.invalidPaths });
  }
  if (!["PLANNING", "COLLECTING_ITEM"].includes(input.cart.status)) return blockedResult(input, "UNSAFE_CART_STATE");

  const mutation = startCurrentItem({ cart: input.cart, productId: input.productContext.productId });
  return mutation.accepted
    ? result({ cart: mutation.cart, context: input, success: true, changed: true, nextStep: "COLLECT_CURRENT_ITEM" })
    : result({ cart: mutation.cart, context: input, success: false, changed: false, failureCode: "CART_MUTATION_REJECTED", invalidItemFields: mutation.invalidPaths });
}
