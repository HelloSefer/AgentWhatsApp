import { initializeCart, usesImplicitPlannedPieceSlots } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import { handleItemOptionAction } from "../actions/item-option-action-handler.service";
import { normalizeItemOptionActionId } from "../actions/item-option-action-normalizer.service";
import {
  finalizeCurrentItemCollection,
  setCurrentItemCollectionOption,
  startItemCollection,
  startNextItemCollection,
} from "../item-collection.service";
import { buildItemCollectionPresentation } from "../presentation/item-collection-presentation.service";
import { analyzeItemCollectionProgression } from "../progression/item-collection-progression.service";
import { runItemCollectionLoop } from "../loop/item-collection-loop.service";
import {
  buildSameAsPreviousPresentation,
  evaluateSameAsPreviousEligibility,
  handleSameAsPreviousAction,
  normalizeSameAsPreviousActionId,
  normalizeSameAsPreviousPreviewState,
} from "../shortcuts/same-as-previous.service";
import type { SameAsPreviousPreviewState } from "../shortcuts/same-as-previous.types";
import type {
  ItemCollectionPreviewInput,
  ItemCollectionPreviewNextStep,
  ItemCollectionPreviewResult,
} from "./item-collection-preview.types";

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

function cloneActionResult(
  actionResult: NonNullable<ItemCollectionPreviewResult["actionResult"]>,
): NonNullable<ItemCollectionPreviewResult["actionResult"]> {
  return {
    ...actionResult,
    ...(actionResult.action ? { action: { ...actionResult.action } } : {}),
    ...(actionResult.collectionResult
      ? {
          collectionResult: {
            ...actionResult.collectionResult,
            cart: cloneCart(actionResult.collectionResult.cart),
            progress: { ...actionResult.collectionResult.progress },
            requiredItemFields: [...actionResult.collectionResult.requiredItemFields],
            missingItemFields: actionResult.collectionResult.missingItemFields
              ? [...actionResult.collectionResult.missingItemFields]
              : undefined,
            invalidItemFields: actionResult.collectionResult.invalidItemFields
              ? [...actionResult.collectionResult.invalidItemFields]
              : undefined,
            warnings: [...actionResult.collectionResult.warnings],
          },
        }
      : {}),
    ...(actionResult.progression
      ? {
          progression: {
            ...actionResult.progression,
            progress: { ...actionResult.progression.progress },
            ...(actionResult.progression.field ? { field: { ...actionResult.progression.field } } : {}),
            invalidFields: [...actionResult.progression.invalidFields],
            warnings: [...actionResult.progression.warnings],
          },
        }
      : {}),
    warnings: [...actionResult.warnings],
  };
}

function isActionProvided(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isQuantityTextProvided(value: unknown): boolean {
  return value !== undefined;
}

function nextStepFor(
  presentation: ItemCollectionPreviewResult["presentation"],
): ItemCollectionPreviewNextStep | undefined {
  switch (presentation?.promptKey) {
    case "SELECT_ITEM_OPTION":
      return "SELECT_ITEM_OPTION";
    case "ENTER_ITEM_OPTION":
      return "ENTER_ITEM_OPTION";
    case "SELECT_ITEM_QUANTITY":
      return "ENTER_ITEM_QUANTITY";
    case "CART_REVIEW_READY":
      return "CART_REVIEW_READY";
    default:
      return undefined;
  }
}

function result(input: {
  handled: boolean;
  success: boolean;
  route: ItemCollectionPreviewResult["route"];
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
  collectionResult?: ItemCollectionPreviewResult["collectionResult"];
  actionResult?: ItemCollectionPreviewResult["actionResult"];
  loopResult?: ItemCollectionPreviewResult["loopResult"];
  shortcutPresentation?: ItemCollectionPreviewResult["shortcutPresentation"];
  previewState: SameAsPreviousPreviewState;
  progression?: ItemCollectionPreviewResult["progression"];
  presentation?: ItemCollectionPreviewResult["presentation"];
  nextStep?: ItemCollectionPreviewNextStep;
  failureCode?: string;
  warnings?: string[];
  appliedInitialOptionKeys?: string[];
}): ItemCollectionPreviewResult {
  return {
    handled: input.handled,
    success: input.success,
    route: input.route,
    cartBefore: cloneCart(input.cartBefore),
    cartAfter: cloneCart(input.cartAfter || input.cartBefore),
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
    ...(input.actionResult ? { actionResult: cloneActionResult(input.actionResult) } : {}),
    ...(input.loopResult ? { loopResult: input.loopResult } : {}),
    ...(input.shortcutPresentation
      ? {
          shortcutPresentation: {
            ...input.shortcutPresentation,
            uiHints: {
              ...input.shortcutPresentation.uiHints,
              options: input.shortcutPresentation.uiHints.options?.map((option) => ({ ...option })),
            },
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
    ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    ...(input.appliedInitialOptionKeys?.length
      ? { appliedInitialOptionKeys: [...input.appliedInitialOptionKeys] }
      : {}),
    previewState: { ...input.previewState },
    warnings: [...(input.warnings || [])],
  };
}

function describeProgression(input: ItemCollectionPreviewInput, cart: CartDraft) {
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
  const previewState = normalizeSameAsPreviousPreviewState(input.previewState, cart);
  // The shortcut is an explicit D3 preview contract. Existing preview callers
  // keep their D2D loop behavior until they opt in by returning this state.
  const eligibility = input.previewState === undefined
    ? undefined
    : evaluateSameAsPreviousEligibility({ ...input, cart, previewState });
  const shortcutPresentation = eligibility?.eligible
    ? buildSameAsPreviousPresentation()
    : undefined;
  return {
    progression,
    presentation,
    shortcutPresentation,
    previewState,
    nextStep: shortcutPresentation
      ? "SAME_OR_DIFFERENT_ITEM_OPTIONS" as const
      : nextStepFor(presentation),
  };
}

function applyInitialItemOptions(input: ItemCollectionPreviewInput, cart: CartDraft): {
  cart: CartDraft;
  appliedKeys: string[];
  warnings: string[];
} {
  if (
    !input.initialItemOptions ||
    cart.items.length > 0 ||
    !cart.currentItemDraft ||
    !usesImplicitPlannedPieceSlots(cart)
  ) {
    return { cart, appliedKeys: [], warnings: [] };
  }

  let workingCart = cart;
  const appliedKeys: string[] = [];
  const warnings: string[] = [];
  for (const [optionKey, value] of Object.entries(input.initialItemOptions)) {
    const applied = setCurrentItemCollectionOption({
      cart: workingCart,
      sellerId: input.sellerId,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
      optionKey,
      value,
    });
    if (!applied.success) {
      warnings.push(`pending_item_option_ignored:${optionKey}`);
      continue;
    }
    workingCart = applied.cart;
    appliedKeys.push(optionKey);
  }

  return { cart: workingCart, appliedKeys, warnings };
}

function automaticallyFinalizePlannedSlot(input: ItemCollectionPreviewInput, cart: CartDraft): {
  cart: CartDraft;
  progression: ReturnType<typeof analyzeItemCollectionProgression>;
  presentation: ReturnType<typeof buildItemCollectionPresentation>;
  warnings: string[];
} {
  const before = describeProgression(input, cart);
  if (!usesImplicitPlannedPieceSlots(cart) || before.progression.step !== "READY_TO_FINALIZE") {
    return {
      cart,
      progression: before.progression,
      presentation: before.presentation,
      warnings: before.progression.warnings,
    };
  }

  const finalized = finalizeCurrentItemCollection({
    cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });
  if (!finalized.success || finalized.progress.remainingUnits === 0) {
    const next = describeProgression(input, finalized.cart);
    return {
      cart: finalized.cart,
      progression: next.progression,
      presentation: next.presentation,
      warnings: [...finalized.warnings, ...next.progression.warnings],
    };
  }

  const nextItem = startNextItemCollection({
    cart: finalized.cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });
  const next = describeProgression(input, nextItem.cart);
  return {
    cart: nextItem.cart,
    progression: next.progression,
    presentation: next.presentation,
    warnings: [...finalized.warnings, ...nextItem.warnings, ...next.progression.warnings],
  };
}

/**
 * Explicit preview-only item collection orchestration. The caller owns cart
 * handoff between requests; this module never persists preview state.
 */
export function runItemCollectionPreview(
  input: ItemCollectionPreviewInput,
): ItemCollectionPreviewResult {
  const cartBefore = cloneCart(input.cart || initializeCart());
  const previewState = normalizeSameAsPreviousPreviewState(input.previewState, cartBefore);
  if (!input.previewEnabled) {
    return result({ handled: false, success: false, route: "NOT_HANDLED", cartBefore, previewState });
  }

  if (isActionProvided(input.rawActionId)) {
    const shortcutNormalization = normalizeSameAsPreviousActionId(input.rawActionId);
    if (shortcutNormalization.recognized) {
      // Give the shortcut handler the caller's original state so it can reject
      // a delayed click that belongs to a previously completed item.
      const shortcut = handleSameAsPreviousAction({ ...input, cart: cartBefore, previewState: input.previewState, rawActionId: input.rawActionId });
      const completed = automaticallyFinalizePlannedSlot(
        { ...input, previewState: shortcut.previewState },
        shortcut.cartAfter,
      );
      const next = describeProgression({ ...input, previewState: shortcut.previewState }, completed.cart);
      return result({
        handled: shortcut.handled,
        success: shortcut.success,
        route: shortcut.success
          ? next.nextStep === "ENTER_ITEM_QUANTITY"
            ? "QUANTITY_REQUIRED"
            : "OPTION_ACTION"
          : "BLOCKED",
        cartBefore,
        cartAfter: completed.cart,
        progression: next.progression,
        presentation: next.presentation,
        shortcutPresentation: next.shortcutPresentation,
        previewState: next.previewState,
        nextStep: next.nextStep,
        failureCode: shortcut.failureCode,
        warnings: [...shortcut.warnings, ...completed.warnings],
      });
    }
    const normalization = normalizeItemOptionActionId(input.rawActionId);
    if (!normalization.recognized) {
      return result({ handled: false, success: false, route: "NOT_HANDLED", cartBefore, previewState });
    }
    if (!normalization.valid || !normalization.action) {
      return result({
        handled: true,
        success: false,
        route: "BLOCKED",
        cartBefore,
        previewState,
        failureCode: normalization.failureCode,
      });
    }

    const actionResult = handleItemOptionAction({
      action: normalization.action,
      cart: cartBefore,
      sellerId: input.sellerId,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
    });
    const cartAfter = actionResult.collectionResult?.cart || cartBefore;
    const completed = automaticallyFinalizePlannedSlot({ ...input, previewState }, cartAfter);
    const next = describeProgression({ ...input, previewState }, completed.cart);
    const nextStep = next.nextStep;

    return result({
      handled: true,
      success: actionResult.success,
      route: actionResult.success
        ? nextStep === "ENTER_ITEM_QUANTITY"
          ? "QUANTITY_REQUIRED"
          : "OPTION_ACTION"
        : "BLOCKED",
      cartBefore,
      cartAfter: completed.cart,
      actionResult,
      progression: next.progression,
      presentation: next.presentation,
      shortcutPresentation: next.shortcutPresentation,
      previewState: next.previewState,
      nextStep,
      failureCode: actionResult.failureCode,
      warnings: [...actionResult.warnings, ...completed.warnings],
    });
  }

  if (isQuantityTextProvided(input.itemCollectionText)) {
    const loopResult = runItemCollectionLoop({
      cart: cartBefore,
      sellerId: input.sellerId,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
      quantityText: input.itemCollectionText,
    });
    const next = describeProgression({ ...input, previewState }, loopResult.cartAfter);
    const route = loopResult.success
      ? "LOOP_COMPLETED"
      : loopResult.nextStep === "RETRY_ITEM_QUANTITY" || loopResult.nextStep === "ENTER_ITEM_QUANTITY"
        ? "QUANTITY_REQUIRED"
        : "BLOCKED";

    return result({
      handled: loopResult.handled,
      success: loopResult.success,
      route,
      cartBefore,
      cartAfter: loopResult.cartAfter,
      loopResult,
      progression: next.progression,
      presentation: next.presentation,
      shortcutPresentation: next.shortcutPresentation,
      previewState: next.previewState,
      nextStep: next.shortcutPresentation ? next.nextStep : loopResult.nextStep,
      failureCode: loopResult.failureCode,
      warnings: loopResult.warnings,
    });
  }

  const collectionResult = startItemCollection({
    cart: cartBefore,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });
  const seeded = applyInitialItemOptions(input, collectionResult.cart);
  const completed = automaticallyFinalizePlannedSlot(input, seeded.cart);
  const next = describeProgression({ ...input, previewState }, completed.cart);
  return result({
    handled: true,
    success: collectionResult.success,
    route: collectionResult.success
      ? next.nextStep === "ENTER_ITEM_QUANTITY"
        ? "QUANTITY_REQUIRED"
        : "COLLECTION_STARTED"
      : "BLOCKED",
    cartBefore,
    cartAfter: completed.cart,
    collectionResult,
    progression: next.progression,
    presentation: next.presentation,
    shortcutPresentation: next.shortcutPresentation,
    previewState: next.previewState,
    nextStep: next.nextStep,
    failureCode: collectionResult.failureCode,
    warnings: [...collectionResult.warnings, ...seeded.warnings, ...completed.warnings, ...next.progression.warnings],
    appliedInitialOptionKeys: seeded.appliedKeys,
  });
}
