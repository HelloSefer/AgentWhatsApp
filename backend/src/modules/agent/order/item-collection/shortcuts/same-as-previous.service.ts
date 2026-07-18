import type { CartDraft, SupportedOrderFieldValue } from "../../cart-state.types";
import { getRequiredItemCollectionFields, validateItemCollectionOption } from "../item-collection-requirements.service";
import { setCurrentItemCollectionOption } from "../item-collection.service";
import { buildItemCollectionPresentation } from "../presentation/item-collection-presentation.service";
import { analyzeItemCollectionProgression } from "../progression/item-collection-progression.service";
import {
  SAME_AS_PREVIOUS_PREVIEW_STATE_VERSION,
  type SameAsPreviousActionNormalizationResult,
  type SameAsPreviousEligibilityResult,
  type SameAsPreviousHandleResult,
  type SameAsPreviousInput,
  type SameAsPreviousPresentation,
  type SameAsPreviousPreviewState,
} from "./same-as-previous.types";

const SAME_ACTION_ID = "cart_item_previous:same" as const;
const DIFFERENT_ACTION_ID = "cart_item_previous:different" as const;

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

function cloneState(state: SameAsPreviousPreviewState): SameAsPreviousPreviewState {
  return { ...state };
}

export function normalizeSameAsPreviousPreviewState(
  state: SameAsPreviousPreviewState | undefined,
  cart: CartDraft,
): SameAsPreviousPreviewState {
  const currentItemId = cart.currentItemDraft?.id;
  if (
    state?.version === SAME_AS_PREVIOUS_PREVIEW_STATE_VERSION &&
    state.currentItemId === currentItemId &&
    (state.decision === "same" || state.decision === "different")
  ) {
    return cloneState(state);
  }

  return {
    version: SAME_AS_PREVIOUS_PREVIEW_STATE_VERSION,
    ...(currentItemId ? { currentItemId } : {}),
  };
}

function hasCurrentOptions(cart: CartDraft): boolean {
  return Boolean(cart.currentItemDraft && Object.keys(cart.currentItemDraft.selectedOptions).length > 0);
}

function describe(input: SameAsPreviousInput, cart: CartDraft) {
  const progression = analyzeItemCollectionProgression({
    cart,
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
  });
  const presentation = buildItemCollectionPresentation({ progression, requiredFields: input.requiredFields });
  return { progression, presentation };
}

function latestReusableItem(input: SameAsPreviousInput) {
  return [...input.cart.items]
    .reverse()
    .find((item) => item.productId === input.productContext.productId && item.status === "COMPLETE");
}

function eligibleResult(input: {
  eligible: boolean;
  failureCode?: SameAsPreviousEligibilityResult["failureCode"];
  previousItemId?: string;
  reusableFieldKeys?: string[];
  warnings?: string[];
}): SameAsPreviousEligibilityResult {
  return {
    eligible: input.eligible,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    ...(input.previousItemId ? { previousItemId: input.previousItemId } : {}),
    reusableFieldKeys: [...(input.reusableFieldKeys || [])],
    warnings: [...(input.warnings || [])],
  };
}

/** Recognizes only the two dedicated, platform-neutral previous-item actions. */
export function normalizeSameAsPreviousActionId(rawId: unknown): SameAsPreviousActionNormalizationResult {
  if (rawId !== SAME_ACTION_ID && rawId !== DIFFERENT_ACTION_ID) {
    return { recognized: false, valid: false, failureCode: "NOT_SAME_AS_PREVIOUS_ACTION" };
  }

  return {
    recognized: true,
    valid: true,
    action: rawId === SAME_ACTION_ID
      ? { type: "SAME_AS_PREVIOUS", rawId: SAME_ACTION_ID }
      : { type: "DIFFERENT_CHOICES", rawId: DIFFERENT_ACTION_ID },
  };
}

/** Read-only eligibility check for a fresh draft following at least one item. */
export function evaluateSameAsPreviousEligibility(
  input: SameAsPreviousInput,
): SameAsPreviousEligibilityResult {
  const state = normalizeSameAsPreviousPreviewState(input.previewState, input.cart);
  const { progression } = describe(input, input.cart);
  const current = input.cart.currentItemDraft;
  if (!current) return eligibleResult({ eligible: false, failureCode: "CURRENT_ITEM_MISSING" });
  if (current.productId !== input.productContext.productId || input.sellerId !== input.productContext.sellerId) {
    return eligibleResult({ eligible: false, failureCode: "PRODUCT_MISMATCH" });
  }
  if (input.cart.status !== "COLLECTING_ITEM" || progression.step === "BLOCKED") {
    return eligibleResult({ eligible: false, failureCode: "UNSAFE_CART_STATE", warnings: progression.warnings });
  }
  if (progression.progress.remainingUnits <= 0) {
    return eligibleResult({ eligible: false, failureCode: "TARGET_ALREADY_FULFILLED" });
  }
  if (state.decision) return eligibleResult({ eligible: false, failureCode: "SHORTCUT_ALREADY_DECIDED" });
  if (hasCurrentOptions(input.cart)) return eligibleResult({ eligible: false, failureCode: "CURRENT_DRAFT_ALREADY_CONFIGURED" });
  if (progression.step !== "COLLECT_OPTION") {
    return eligibleResult({ eligible: false, failureCode: "PROGRESSION_NOT_COLLECTING_OPTION" });
  }

  const previous = latestReusableItem(input);
  if (!previous) return eligibleResult({ eligible: false, failureCode: "PREVIOUS_ITEM_MISSING" });
  const requiredFields = getRequiredItemCollectionFields(input.requiredFields);
  if (!requiredFields.length) return eligibleResult({ eligible: false, failureCode: "OPTIONLESS_PRODUCT" });

  for (const field of requiredFields) {
    const value = previous.selectedOptions[field.key];
    const validation = validateItemCollectionOption({
      fields: input.requiredFields,
      optionKey: field.key,
      value,
    });
    if (!validation.valid || validation.option.value !== value) {
      return eligibleResult({ eligible: false, failureCode: "PREVIOUS_ITEM_OPTIONS_INVALID" });
    }
  }

  return eligibleResult({
    eligible: true,
    previousItemId: previous.id,
    reusableFieldKeys: requiredFields.map((field) => field.key),
  });
}

/** Platform-neutral selector metadata; labels never act as authority. */
export function buildSameAsPreviousPresentation(): SameAsPreviousPresentation {
  return {
    promptKey: "SAME_OR_DIFFERENT_ITEM_OPTIONS",
    previewOnly: true,
    uiHints: {
      kind: "buttons",
      purpose: "field_options",
      body: "بغيتي نفس الاختيارات ولا اختيارات مختلفة؟",
      options: [
        { id: SAME_ACTION_ID, label: "نفس الاختيارات", value: "same" },
        { id: DIFFERENT_ACTION_ID, label: "اختيارات مختلفة", value: "different" },
      ],
      previewOnly: true,
    },
  };
}

function handleResult(input: Omit<SameAsPreviousHandleResult, "cartBefore" | "cartAfter" | "previewState"> & {
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
  previewState: SameAsPreviousPreviewState;
}): SameAsPreviousHandleResult {
  return {
    ...input,
    cartBefore: cloneCart(input.cartBefore),
    cartAfter: cloneCart(input.cartAfter || input.cartBefore),
    ...(input.action ? { action: { ...input.action } } : {}),
    ...(input.collectionResults
      ? {
          collectionResults: input.collectionResults.map((collectionResult) => ({
            ...collectionResult,
            cart: cloneCart(collectionResult.cart),
            progress: { ...collectionResult.progress },
            requiredItemFields: [...collectionResult.requiredItemFields],
            missingItemFields: collectionResult.missingItemFields ? [...collectionResult.missingItemFields] : undefined,
            invalidItemFields: collectionResult.invalidItemFields ? [...collectionResult.invalidItemFields] : undefined,
            warnings: [...collectionResult.warnings],
          })),
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
              ? { uiHints: { ...input.presentation.uiHints, options: input.presentation.uiHints.options?.map((option) => ({ ...option })) } }
              : {}),
            warnings: [...input.presentation.warnings],
          },
        }
      : {}),
    previewState: cloneState(input.previewState),
    warnings: [...input.warnings],
  };
}

function isSameAlreadyApplied(input: SameAsPreviousInput, state: SameAsPreviousPreviewState): boolean {
  if (state.decision !== "same" || !input.cart.currentItemDraft) return false;
  const previous = latestReusableItem(input);
  if (!previous) return false;
  return getRequiredItemCollectionFields(input.requiredFields).every(
    (field) => input.cart.currentItemDraft?.selectedOptions[field.key] === previous.selectedOptions[field.key],
  );
}

/**
 * Runs Same/Different through trusted D1 commands only. Same values are
 * validated before the first write so a failed copy leaves the draft intact.
 */
export function handleSameAsPreviousAction(input: SameAsPreviousInput & { rawActionId: unknown }): SameAsPreviousHandleResult {
  const cartBefore = cloneCart(input.cart);
  const state = normalizeSameAsPreviousPreviewState(input.previewState, cartBefore);
  const normalization = normalizeSameAsPreviousActionId(input.rawActionId);
  if (!normalization.recognized || !normalization.valid || !normalization.action) {
    return handleResult({ handled: false, success: false, changed: false, cartBefore, previewState: state, failureCode: normalization.failureCode, warnings: [] });
  }

  if (!input.previewState) {
    return handleResult({ handled: true, success: false, changed: false, cartBefore, action: normalization.action, previewState: state, failureCode: "PREVIEW_STATE_REQUIRED", warnings: [] });
  }
  if (
    input.previewState.version === SAME_AS_PREVIOUS_PREVIEW_STATE_VERSION &&
    input.previewState.currentItemId !== cartBefore.currentItemDraft?.id
  ) {
    return handleResult({ handled: true, success: false, changed: false, cartBefore, action: normalization.action, previewState: state, failureCode: "STALE_PREVIEW_STATE", warnings: [] });
  }

  const current = describe(input, cartBefore);
  if (normalization.action.type === "DIFFERENT_CHOICES" && state.decision === "different") {
    return handleResult({ handled: true, success: true, changed: false, cartBefore, action: normalization.action, progression: current.progression, presentation: current.presentation, previewState: state, warnings: current.progression.warnings });
  }
  if (normalization.action.type === "SAME_AS_PREVIOUS" && isSameAlreadyApplied(input, state)) {
    return handleResult({ handled: true, success: true, changed: false, cartBefore, action: normalization.action, progression: current.progression, presentation: current.presentation, previewState: state, warnings: current.progression.warnings });
  }

  const eligibility = evaluateSameAsPreviousEligibility({ ...input, cart: cartBefore, previewState: state });
  if (!eligibility.eligible) {
    return handleResult({ handled: true, success: false, changed: false, cartBefore, action: normalization.action, progression: current.progression, presentation: current.presentation, previewState: state, failureCode: eligibility.failureCode, warnings: eligibility.warnings });
  }

  if (normalization.action.type === "DIFFERENT_CHOICES") {
    const nextState: SameAsPreviousPreviewState = { ...state, decision: "different" };
    return handleResult({ handled: true, success: true, changed: false, cartBefore, action: normalization.action, progression: current.progression, presentation: current.presentation, previewState: nextState, warnings: current.progression.warnings });
  }

  const previous = latestReusableItem({ ...input, cart: cartBefore });
  const reusableFields = getRequiredItemCollectionFields(input.requiredFields);
  if (!previous) {
    return handleResult({ handled: true, success: false, changed: false, cartBefore, action: normalization.action, progression: current.progression, presentation: current.presentation, previewState: state, failureCode: "PREVIOUS_ITEM_MISSING", warnings: [] });
  }

  const values: Array<{ key: string; value: SupportedOrderFieldValue }> = [];
  for (const field of reusableFields) {
    const value = previous.selectedOptions[field.key];
    const validation = validateItemCollectionOption({ fields: input.requiredFields, optionKey: field.key, value });
    if (!validation.valid || validation.option.value !== value) {
      return handleResult({ handled: true, success: false, changed: false, cartBefore, action: normalization.action, progression: current.progression, presentation: current.presentation, previewState: state, failureCode: "PREVIOUS_ITEM_OPTIONS_INVALID", warnings: [] });
    }
    values.push({ key: field.key, value });
  }

  let workingCart = cartBefore;
  const collectionResults = [];
  for (const value of values) {
    const copied = setCurrentItemCollectionOption({
      cart: workingCart,
      sellerId: input.sellerId,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
      optionKey: value.key,
      value: value.value,
    });
    if (!copied.success) {
      return handleResult({ handled: true, success: false, changed: false, cartBefore, action: normalization.action, progression: current.progression, presentation: current.presentation, previewState: state, failureCode: "COPY_REJECTED", warnings: copied.warnings });
    }
    collectionResults.push(copied);
    workingCart = copied.cart;
  }

  const next = describe(input, workingCart);
  if (next.progression.step !== "COLLECT_QUANTITY") {
    return handleResult({ handled: true, success: false, changed: false, cartBefore, action: normalization.action, progression: current.progression, presentation: current.presentation, previewState: state, failureCode: "COPY_NOT_COMPLETE", warnings: next.progression.warnings });
  }

  return handleResult({
    handled: true,
    success: true,
    changed: collectionResults.some((collectionResult) => collectionResult.changed),
    cartBefore,
    cartAfter: workingCart,
    action: normalization.action,
    collectionResults,
    progression: next.progression,
    presentation: next.presentation,
    previewState: { ...state, decision: "same" },
    warnings: next.progression.warnings,
  });
}
