import { MAX_CART_ITEM_QUANTITY } from "../../cart-state.service";
import {
  getRequiredItemCollectionFields,
  validateItemCollectionOption,
} from "../item-collection-requirements.service";
import { inspectItemCollectionState } from "../item-collection.service";
import type {
  ItemCollectionProgressionField,
  ItemCollectionProgressionInput,
  ItemCollectionProgressionResult,
} from "./item-collection-progression.types";

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function isValidExplicitQuantity(value: unknown, explicitlySet: boolean | undefined): value is number {
  return (
    explicitlySet === true &&
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_CART_ITEM_QUANTITY
  );
}

function toField(field: import("../../../config/required-fields.types").RequiredOrderField): ItemCollectionProgressionField {
  return {
    key: field.key,
    ...(field.label ? { label: field.label } : {}),
    ...(field.semanticType ? { semanticType: field.semanticType } : {}),
    required: field.required,
    configuredOrder: field.askOrder,
  };
}

function result(input: {
  success: boolean;
  step: ItemCollectionProgressionResult["step"];
  progress: ItemCollectionProgressionResult["progress"];
  field?: ItemCollectionProgressionField;
  failureCode?: ItemCollectionProgressionResult["failureCode"];
  invalidFields?: string[];
  warnings?: string[];
}): ItemCollectionProgressionResult {
  return {
    success: input.success,
    step: input.step,
    progress: { ...input.progress },
    ...(input.field ? { field: { ...input.field } } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    invalidFields: [...(input.invalidFields || [])],
    warnings: [...(input.warnings || [])],
  };
}

function isBlockedLifecycle(status: ItemCollectionProgressionInput["cart"]["status"]): boolean {
  return [
    "COLLECTING_DELIVERY",
    "AWAITING_CONFIRMATION",
    "CONFIRMED",
    "CANCELLED",
  ].includes(status);
}

/**
 * Pure item-loop progression analysis. It deliberately never executes D1
 * commands; callers decide whether to apply the next command later.
 */
export function analyzeItemCollectionProgression(
  input: ItemCollectionProgressionInput,
): ItemCollectionProgressionResult {
  const inspection = inspectItemCollectionState(input);
  const { cart } = input;
  const { progress } = inspection;

  if (isBlockedLifecycle(cart.status)) {
    return result({
      success: false,
      step: "BLOCKED",
      progress,
      failureCode: "UNSAFE_CART_STATE",
    });
  }

  if (cart.status === "CART_REVIEW") {
    if (inspection.valid && progress.remainingUnits === 0 && !cart.currentItemDraft) {
      return result({ success: true, step: "CART_REVIEW_READY", progress });
    }
    return result({
      success: false,
      step: "BLOCKED",
      progress,
      failureCode: "UNSAFE_CART_STATE",
    });
  }

  const canAnalyzeDraftLocally =
    inspection.failureCode === "INVALID_CART" &&
    cart.schemaVersion === 1 &&
    cart.status === "COLLECTING_ITEM" &&
    Boolean(cart.currentItemDraft);
  if (!inspection.valid && !canAnalyzeDraftLocally) {
    return result({
      success: false,
      step: "BLOCKED",
      progress,
      failureCode: inspection.failureCode,
      warnings: inspection.warnings,
    });
  }

  if (!cart.currentItemDraft) {
    if (progress.completedUnits > progress.targetUnits) {
      return result({ success: false, step: "BLOCKED", progress, failureCode: "TARGET_OVERFILLED" });
    }
    if (progress.remainingUnits === 0) {
      return result({ success: true, step: "CART_REVIEW_READY", progress });
    }
    if (progress.completedUnits === 0) {
      return result({
        success: true,
        step: cart.status === "PLANNING" ? "START_COLLECTION" : "START_CURRENT_ITEM",
        progress,
      });
    }
    return result({ success: true, step: "START_NEXT_ITEM", progress });
  }

  if (cart.status !== "COLLECTING_ITEM") {
    return result({ success: false, step: "BLOCKED", progress, failureCode: "UNSAFE_CART_STATE" });
  }

  const requiredFields = getRequiredItemCollectionFields(input.requiredFields);
  for (const field of requiredFields) {
    const value = cart.currentItemDraft.selectedOptions[field.key];
    if (isBlank(value)) {
      return result({ success: true, step: "COLLECT_OPTION", progress, field: toField(field) });
    }

    const validation = validateItemCollectionOption({
      fields: input.requiredFields,
      optionKey: field.key,
      value,
    });
    if (!validation.valid) {
      return result({
        success: false,
        step: "COLLECT_OPTION",
        progress,
        field: toField(field),
        failureCode: validation.failureCode,
        invalidFields: [field.key],
      });
    }
  }

  for (const [key, value] of Object.entries(cart.currentItemDraft.selectedOptions)) {
    const validation = validateItemCollectionOption({
      fields: input.requiredFields,
      optionKey: key,
      value,
    });
    if (!validation.valid) {
      return result({
        success: false,
        step: "BLOCKED",
        progress,
        failureCode: validation.failureCode,
        invalidFields: [key],
      });
    }
  }

  if (!isValidExplicitQuantity(
    cart.currentItemDraft.quantity,
    cart.currentItemDraft.quantityExplicitlySet,
  )) {
    return result({
      success: false,
      step: "COLLECT_QUANTITY",
      progress,
      failureCode: "INVALID_ITEM_QUANTITY",
    });
  }
  if (cart.currentItemDraft.quantity > progress.remainingUnits) {
    return result({
      success: false,
      step: "BLOCKED",
      progress,
      failureCode: "QUANTITY_EXCEEDS_REMAINING_TARGET",
    });
  }

  return result({ success: true, step: "READY_TO_FINALIZE", progress });
}
