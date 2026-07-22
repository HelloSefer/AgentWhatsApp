import {
  getItemCollectionOptionFields,
} from "../item-collection-requirements.service";
import { setCurrentItemCollectionOption } from "../item-collection.service";
import { analyzeItemCollectionProgression } from "../progression/item-collection-progression.service";
import type { ItemCollectionProgressionResult } from "../progression/item-collection-progression.types";
import { normalizeItemOptionActionId } from "./item-option-action-normalizer.service";
import type {
  ItemOptionActionHandleResult,
  ItemOptionActionHandlerInput,
} from "./item-option-action.types";
import { resolveConfiguredOptionCanonicalValue } from "../../../../conversation-engine/config/conversation-product-config.service";

function cloneProgression(progression: ItemCollectionProgressionResult): ItemCollectionProgressionResult {
  return {
    ...progression,
    progress: { ...progression.progress },
    ...(progression.field ? { field: { ...progression.field } } : {}),
    invalidFields: [...progression.invalidFields],
    warnings: [...progression.warnings],
  };
}

function result(input: ItemOptionActionHandleResult): ItemOptionActionHandleResult {
  return {
    ...input,
    ...(input.action ? { action: { ...input.action } } : {}),
    ...(input.collectionResult
      ? {
          collectionResult: {
            ...input.collectionResult,
            cart: {
              ...input.collectionResult.cart,
              items: input.collectionResult.cart.items.map((item) => ({
                ...item,
                selectedOptions: { ...item.selectedOptions },
              })),
              currentItemDraft: input.collectionResult.cart.currentItemDraft
                ? {
                    ...input.collectionResult.cart.currentItemDraft,
                    selectedOptions: { ...input.collectionResult.cart.currentItemDraft.selectedOptions },
                  }
                : undefined,
              orderLevelFields: { ...input.collectionResult.cart.orderLevelFields },
            },
            progress: { ...input.collectionResult.progress },
            requiredItemFields: [...input.collectionResult.requiredItemFields],
            missingItemFields: input.collectionResult.missingItemFields
              ? [...input.collectionResult.missingItemFields]
              : undefined,
            invalidItemFields: input.collectionResult.invalidItemFields
              ? [...input.collectionResult.invalidItemFields]
              : undefined,
            warnings: [...input.collectionResult.warnings],
          },
        }
      : {}),
    ...(input.progression ? { progression: cloneProgression(input.progression) } : {}),
    warnings: [...input.warnings],
  };
}

function findExactField(
  fields: ItemOptionActionHandlerInput["requiredFields"],
  key: string,
) {
  return getItemCollectionOptionFields(fields).find((field) => field.key === key);
}

function deriveProgression(input: ItemOptionActionHandlerInput): ItemCollectionProgressionResult {
  return analyzeItemCollectionProgression({
    cart: input.cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });
}

/**
 * Validates a D2B action against trusted D2A/config state, then delegates the
 * single permitted mutation to D1. It performs no lifecycle orchestration.
 */
export function handleItemOptionAction(
  input: ItemOptionActionHandlerInput,
): ItemOptionActionHandleResult {
  const normalization = normalizeItemOptionActionId(input.action.rawId);
  if (!normalization.valid || !normalization.action) {
    return result({
      handled: true,
      success: false,
      changed: false,
      failureCode: normalization.failureCode || "ACTION_NOT_VALID",
      warnings: [],
    });
  }
  if (
    normalization.action.fieldKey !== input.action.fieldKey ||
    normalization.action.canonicalValue !== input.action.canonicalValue
  ) {
    return result({
      handled: true,
      success: false,
      changed: false,
      action: normalization.action,
      failureCode: "ACTION_NOT_VALID",
      warnings: [],
    });
  }

  const progression = deriveProgression(input);
  if (progression.step === "BLOCKED") {
    return result({
      handled: true,
      success: false,
      changed: false,
      action: normalization.action,
      progression,
      failureCode: progression.failureCode || "PROGRESSION_NOT_COLLECTING_OPTION",
      warnings: progression.warnings,
    });
  }
  if (!input.cart.currentItemDraft) {
    return result({
      handled: true,
      success: false,
      changed: false,
      action: normalization.action,
      progression,
      failureCode: "CURRENT_ITEM_MISSING",
      warnings: progression.warnings,
    });
  }
  if (progression.step !== "COLLECT_OPTION") {
    return result({
      handled: true,
      success: false,
      changed: false,
      action: normalization.action,
      progression,
      failureCode: "PROGRESSION_NOT_COLLECTING_OPTION",
      warnings: progression.warnings,
    });
  }
  if (progression.field?.key !== normalization.action.fieldKey) {
    return result({
      handled: true,
      success: false,
      changed: false,
      action: normalization.action,
      progression,
      failureCode: "FIELD_NOT_CURRENTLY_EXPECTED",
      warnings: progression.warnings,
    });
  }

  const field = findExactField(input.requiredFields, normalization.action.fieldKey);
  if (!field) {
    return result({
      handled: true,
      success: false,
      changed: false,
      action: normalization.action,
      progression,
      failureCode: "FIELD_NOT_CONFIGURED",
      warnings: progression.warnings,
    });
  }
  if (!field.options?.length) {
    return result({
      handled: true,
      success: false,
      changed: false,
      action: normalization.action,
      progression,
      failureCode: "OPEN_TEXT_ACTION_NOT_SUPPORTED",
      warnings: progression.warnings,
    });
  }
  const canonicalValue = resolveConfiguredOptionCanonicalValue(
    field,
    normalization.action.canonicalValue,
  );
  if (!canonicalValue || !field.options.includes(canonicalValue)) {
    return result({
      handled: true,
      success: false,
      changed: false,
      action: normalization.action,
      progression,
      failureCode: "CANONICAL_VALUE_NOT_CONFIGURED",
      warnings: progression.warnings,
    });
  }

  const collectionResult = setCurrentItemCollectionOption({
    cart: input.cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
    optionKey: field.key,
    value: canonicalValue,
  });
  const nextProgression = analyzeItemCollectionProgression({
    cart: collectionResult.cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });

  return result({
    handled: true,
    success: collectionResult.success,
    changed: collectionResult.changed,
    action: normalization.action,
    collectionResult,
    progression: nextProgression,
    failureCode: collectionResult.failureCode,
    warnings: [...collectionResult.warnings, ...nextProgression.warnings],
  });
}
