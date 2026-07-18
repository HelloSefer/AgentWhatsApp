import type { CartDraft } from "../../cart-state.types";
import {
  finalizeCurrentItemCollection,
  setCurrentItemCollectionQuantity,
  startNextItemCollection,
} from "../item-collection.service";
import { buildItemCollectionPresentation } from "../presentation/item-collection-presentation.service";
import { analyzeItemCollectionProgression } from "../progression/item-collection-progression.service";
import { normalizeCurrentItemQuantity } from "../quantity/current-item-quantity-normalizer.service";
import type {
  ItemCollectionLoopInput,
  ItemCollectionLoopNextStep,
  ItemCollectionLoopResult,
} from "./item-collection-loop.types";

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

function nextStepFor(
  progression: NonNullable<ItemCollectionLoopResult["progression"]>,
  presentation: NonNullable<ItemCollectionLoopResult["presentation"]>,
): ItemCollectionLoopNextStep {
  if (progression.step === "CART_REVIEW_READY") return "CART_REVIEW_READY";
  if (presentation.promptKey === "SELECT_ITEM_OPTION") return "SELECT_ITEM_OPTION";
  if (presentation.promptKey === "ENTER_ITEM_OPTION") return "ENTER_ITEM_OPTION";
  if (presentation.promptKey === "SELECT_ITEM_QUANTITY") return "ENTER_ITEM_QUANTITY";
  return "BLOCKED";
}

function describe(input: ItemCollectionLoopInput, cart: CartDraft) {
  const progression = analyzeItemCollectionProgression({
    cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });
  const presentation = buildItemCollectionPresentation({
    progression,
    requiredFields: input.requiredFields,
  });
  return { progression, presentation, nextStep: nextStepFor(progression, presentation) };
}

function result(input: Omit<ItemCollectionLoopResult, "cartBefore" | "cartAfter"> & {
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
}): ItemCollectionLoopResult {
  return {
    ...input,
    cartBefore: cloneCart(input.cartBefore),
    cartAfter: cloneCart(input.cartAfter || input.cartBefore),
    ...(input.quantityResult ? { quantityResult: { ...input.quantityResult } } : {}),
    ...(input.collectionResult
      ? {
          collectionResult: {
            ...input.collectionResult,
            cart: cloneCart(input.collectionResult.cart),
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
    ...(input.progression
      ? {
          progression: {
            ...input.progression,
            progress: { ...input.progression.progress },
            ...(input.progression.field ? { field: { ...input.progression.field } } : {}),
            invalidFields: [...input.progression.invalidFields],
            warnings: [...input.progression.warnings],
          },
        }
      : {}),
    ...(input.presentation
      ? {
          presentation: {
            ...input.presentation,
            progress: { ...input.presentation.progress },
            ...(input.presentation.field ? { field: { ...input.presentation.field } } : {}),
            ...(input.presentation.uiHints
              ? {
                  uiHints: {
                    ...input.presentation.uiHints,
                    options: input.presentation.uiHints.options?.map((option) => ({ ...option })),
                  },
                }
              : {}),
            warnings: [...input.presentation.warnings],
          },
        }
      : {}),
    warnings: [...input.warnings],
  };
}

/**
 * Completes one current item only after a trusted COLLECT_QUANTITY state.
 * D1 retains ownership of quantity mutation, finalization, and next-item start.
 */
export function runItemCollectionLoop(
  input: ItemCollectionLoopInput,
): ItemCollectionLoopResult {
  const cartBefore = cloneCart(input.cart);
  const current = describe(input, cartBefore);
  if (current.progression.step !== "COLLECT_QUANTITY") {
    return result({
      handled: true,
      success: false,
      changed: false,
      cartBefore,
      progression: current.progression,
      presentation: current.presentation,
      nextStep: "BLOCKED",
      failureCode: cartBefore.currentItemDraft ? "QUANTITY_NOT_CURRENTLY_EXPECTED" : "CURRENT_ITEM_MISSING",
      warnings: current.progression.warnings,
    });
  }
  if (!cartBefore.currentItemDraft) {
    return result({
      handled: true,
      success: false,
      changed: false,
      cartBefore,
      progression: current.progression,
      presentation: current.presentation,
      nextStep: "BLOCKED",
      failureCode: "CURRENT_ITEM_MISSING",
      warnings: current.progression.warnings,
    });
  }

  const quantityResult = normalizeCurrentItemQuantity({
    text: input.quantityText,
    remainingUnits: current.progression.progress.remainingUnits,
  });
  if (!quantityResult.success || quantityResult.quantity === undefined) {
    return result({
      handled: true,
      success: false,
      changed: false,
      cartBefore,
      quantityResult,
      progression: current.progression,
      presentation: current.presentation,
      nextStep: "RETRY_ITEM_QUANTITY",
      failureCode: quantityResult.failureCode,
      warnings: current.progression.warnings,
    });
  }

  const quantitySet = setCurrentItemCollectionQuantity({
    cart: cartBefore,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
    quantity: quantityResult.quantity,
  });
  if (!quantitySet.success) {
    const next = describe(input, quantitySet.cart);
    return result({
      handled: true,
      success: false,
      changed: false,
      cartBefore,
      cartAfter: quantitySet.cart,
      quantityResult,
      collectionResult: quantitySet,
      progression: next.progression,
      presentation: next.presentation,
      nextStep: "RETRY_ITEM_QUANTITY",
      failureCode: quantitySet.failureCode,
      warnings: [...quantitySet.warnings, ...next.progression.warnings],
    });
  }

  const ready = describe(input, quantitySet.cart);
  if (ready.progression.step !== "READY_TO_FINALIZE") {
    return result({
      handled: true,
      success: false,
      changed: quantitySet.changed,
      cartBefore,
      cartAfter: quantitySet.cart,
      quantityResult,
      collectionResult: quantitySet,
      progression: ready.progression,
      presentation: ready.presentation,
      nextStep: "BLOCKED",
      failureCode: "FINALIZATION_NOT_READY",
      warnings: [...quantitySet.warnings, ...ready.progression.warnings],
    });
  }

  const finalized = finalizeCurrentItemCollection({
    cart: quantitySet.cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });
  if (!finalized.success) {
    const next = describe(input, finalized.cart);
    return result({
      handled: true,
      success: false,
      changed: quantitySet.changed,
      cartBefore,
      cartAfter: finalized.cart,
      quantityResult,
      collectionResult: finalized,
      progression: next.progression,
      presentation: next.presentation,
      nextStep: "BLOCKED",
      failureCode: finalized.failureCode,
      warnings: [...finalized.warnings, ...next.progression.warnings],
    });
  }

  if (finalized.progress.remainingUnits === 0) {
    const next = describe(input, finalized.cart);
    return result({
      handled: true,
      success: true,
      changed: true,
      cartBefore,
      cartAfter: finalized.cart,
      quantityResult,
      collectionResult: finalized,
      progression: next.progression,
      presentation: next.presentation,
      finalizedItem: true,
      nextItemStarted: false,
      nextStep: next.nextStep,
      warnings: [...finalized.warnings, ...next.progression.warnings],
    });
  }

  const nextItem = startNextItemCollection({
    cart: finalized.cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });
  const next = describe(input, nextItem.cart);
  return result({
    handled: true,
    success: nextItem.success,
    changed: true,
    cartBefore,
    cartAfter: nextItem.cart,
    quantityResult,
    collectionResult: nextItem,
    progression: next.progression,
    presentation: next.presentation,
    finalizedItem: true,
    nextItemStarted: nextItem.success && nextItem.changed,
    nextStep: nextItem.success ? next.nextStep : "BLOCKED",
    failureCode: nextItem.failureCode,
    warnings: [...finalized.warnings, ...nextItem.warnings, ...next.progression.warnings],
  });
}
