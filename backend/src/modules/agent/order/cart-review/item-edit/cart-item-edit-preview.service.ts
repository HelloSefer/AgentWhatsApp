import type { AgentReplyUiHint } from "../../../reply/reply-renderer.types";
import type { CartDraft } from "../../cart-state.types";
import {
  buildItemCollectionOptionActionId,
  truncateItemCollectionPresentationText,
} from "../../item-collection/presentation/item-collection-presentation.service";
import {
  buildCartReviewPresentation,
  buildCommercialResolutionPresentation,
} from "../cart-review-presentation.service";
import { inspectCartReviewReadiness } from "../cart-review.service";
import type { CartReviewPresentationResult } from "../cart-review.types";
import {
  cartLabel,
  cartMessage,
} from "../../../../conversation-engine/adapters/cart-conversation.adapter";
import {
  beginCartItemEditText,
  captureCartItemEditText,
  normalizeCartItemEditAction,
  normalizeCartItemEditPreviewState,
  saveCartItemEdit,
  selectCartItemEditOption,
  startCartItemEdit,
} from "./cart-item-edit.service";
import type {
  CartItemEditContext,
  CartItemEditPreviewInput,
  CartItemEditPreviewResult,
  CartItemEditPreviewState,
} from "./cart-item-edit.types";
import { getItemCollectionOptionFields } from "../../item-collection/item-collection-requirements.service";

const MAX_BUTTON_OPTIONS = 3;
const MAX_ACTION_SEGMENT_LENGTH = 80;
const UNSAFE_ACTION_SEGMENT = /[:%\s\u0000-\u001F\u007F-\u009F]/u;

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
    ...state,
    workingItem: { ...state.workingItem, selectedOptions: { ...state.workingItem.selectedOptions } },
  };
}

function clonePresentation(presentation: CartReviewPresentationResult): CartReviewPresentationResult {
  return {
    ...presentation,
    ...(presentation.uiHints
      ? { uiHints: { ...presentation.uiHints, options: presentation.uiHints.options?.map((option) => ({ ...option })) } }
      : {}),
    warnings: [...presentation.warnings],
  };
}

function contextFor(input: CartItemEditPreviewInput, cart: CartDraft): CartItemEditContext {
  return {
    sellerId: input.sellerId,
    productContext: input.productContext,
    requiredFields: input.requiredFields,
    offerLookup: input.offerLookup,
    cart,
    now: input.now,
  };
}

function safeTextActionId(fieldKey: string): string | undefined {
  const key = fieldKey.trim();
  const id = `cart_review_item_edit:text:${key}`;
  return key && Array.from(key).length <= MAX_ACTION_SEGMENT_LENGTH && !UNSAFE_ACTION_SEGMENT.test(key)
    ? id
    : undefined;
}

function buildEditPresentation(input: {
  context: CartItemEditContext;
  state: CartItemEditPreviewState;
}): CartReviewPresentationResult {
  const fields = getItemCollectionOptionFields(input.context.requiredFields)
    .filter((field) => !input.state.focusedFieldKey || field.key === input.state.focusedFieldKey);
  const isFocusedField = Boolean(input.state.focusedFieldKey);
  const isFocusedSize = input.state.focusedFieldKey === "size";
  const isFocusedColor = input.state.focusedFieldKey === "color";
  const awaitingField = input.state.awaitingTextFieldKey
    ? fields.find((field) => field.key === input.state.awaitingTextFieldKey)
    : undefined;
  if (awaitingField) {
    return {
      success: true,
      kind: "ITEM_OPTION_TEXT_INPUT",
      promptKey: "ENTER_CART_ITEM_OPTION_TEXT",
      text: cartMessage("cart.option_text_input", {
        optionLabel: awaitingField.label || awaitingField.key,
      }),
      selectedItemId: input.state.sourceItemId,
      uiHints: {
        kind: "buttons",
        purpose: "cart_review",
        body: cartMessage("cart.option_text_input_body"),
        options: [{ id: "cart_review_item_edit:cancel", label: cartLabel("cart.cancel") }],
        previewOnly: true,
      },
      warnings: [],
    };
  }

  const options: NonNullable<AgentReplyUiHint["options"]> = [];
  for (const field of fields) {
    if (field.options?.length) {
      for (const canonicalValue of field.options) {
        const id = buildItemCollectionOptionActionId(field.key, canonicalValue);
        if (!id) continue;
        const current = input.state.workingItem.selectedOptions[field.key] === canonicalValue;
        const focusedLabel = cartMessage(
          current ? "cart.option_row_current" : "cart.option_row",
          { optionLabel: field.label || field.key, optionValue: canonicalValue },
        );
        options.push({
          id,
          label: truncateItemCollectionPresentationText(
            isFocusedField
              ? focusedLabel
              : cartMessage(current ? "cart.option_row_now" : "cart.option_row", {
                  optionLabel: field.label || field.key,
                  optionValue: canonicalValue,
                }),
            48,
          ),
          ...(isFocusedField ? {} : { value: canonicalValue }),
        });
      }
      continue;
    }

    const id = safeTextActionId(field.key);
    if (id) {
      options.push({
        id,
        label: truncateItemCollectionPresentationText(
          cartMessage("cart.edit_option_label", { optionLabel: field.label || field.key }),
          48,
        ),
        value: field.key,
      });
    }
  }
  if (!input.state.autoSaveOnSelection) {
    options.push(
      { id: "cart_review_item_edit:save", label: cartLabel("cart.save") },
      { id: "cart_review_item_edit:cancel", label: cartLabel("cart.cancel") },
    );
  }

  const uiHints: AgentReplyUiHint = {
    kind: options.length <= MAX_BUTTON_OPTIONS ? "buttons" : "list",
    purpose: "cart_review",
    ...(options.length > MAX_BUTTON_OPTIONS ? { title: cartLabel("cart.edit_options_title") } : {}),
    body: isFocusedSize
      ? cartMessage("cart.select_new_size")
      : isFocusedColor
        ? cartMessage("cart.select_new_color")
      : cartMessage("cart.select_new_option"),
    options,
    previewOnly: true,
  };
  return {
    success: true,
    kind: "ITEM_OPTION_EDIT",
    promptKey: "EDIT_CART_ITEM_OPTIONS",
    text: isFocusedSize
      ? cartMessage("cart.select_new_size")
      : isFocusedColor
        ? cartMessage("cart.select_new_color")
        : cartMessage("cart.edit_item_options"),
    selectedItemId: input.state.sourceItemId,
    uiHints,
    warnings: [],
  };
}

function mainPresentation(input: {
  context: CartItemEditContext;
  cart: CartDraft;
}): { presentation?: CartReviewPresentationResult; review?: ReturnType<typeof inspectCartReviewReadiness>["review"]; commercialEvaluation?: ReturnType<typeof inspectCartReviewReadiness>["commercialEvaluation"]; warnings: string[] } {
  const readiness = inspectCartReviewReadiness({ ...input.context, cart: input.cart });
  if (!readiness.ready || !readiness.review) return { warnings: readiness.warnings };
  return {
    review: readiness.review,
    commercialEvaluation: readiness.commercialEvaluation,
    presentation: readiness.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE"
      ? buildCommercialResolutionPresentation()
      : buildCartReviewPresentation(
          readiness.review,
          input.context.productContext.conversationalName,
        ),
    warnings: readiness.warnings,
  };
}

function result(input: {
  handled: boolean;
  success: boolean;
  changed: boolean;
  cartBefore: CartDraft;
  cartAfter?: CartDraft;
  editState?: CartItemEditPreviewState;
  review?: CartItemEditPreviewResult["review"];
  presentation?: CartItemEditPreviewResult["presentation"];
  commercialEvaluation?: CartItemEditPreviewResult["commercialEvaluation"];
  planningResult?: CartItemEditPreviewResult["planningResult"];
  mergedIntoItemId?: string;
  nextStep?: CartItemEditPreviewResult["nextStep"];
  failureCode?: CartItemEditPreviewResult["failureCode"];
  warnings?: string[];
}): CartItemEditPreviewResult {
  return {
    handled: input.handled,
    success: input.success,
    changed: input.changed,
    cartBefore: cloneCart(input.cartBefore),
    cartAfter: cloneCart(input.cartAfter || input.cartBefore),
    ...(input.editState ? { editState: cloneState(input.editState) } : {}),
    ...(input.review ? { review: input.review } : {}),
    ...(input.presentation ? { presentation: clonePresentation(input.presentation) } : {}),
    ...(input.commercialEvaluation ? { commercialEvaluation: input.commercialEvaluation } : {}),
    ...(input.planningResult ? { planningResult: input.planningResult } : {}),
    ...(input.mergedIntoItemId ? { mergedIntoItemId: input.mergedIntoItemId } : {}),
    ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    warnings: [...(input.warnings || [])],
  };
}

function withEditPresentation(input: {
  operation: ReturnType<typeof startCartItemEdit>;
  context: CartItemEditContext;
  nextStep?: CartItemEditPreviewResult["nextStep"];
}): CartItemEditPreviewResult {
  const presentation = input.operation.editState
    ? buildEditPresentation({ context: { ...input.context, cart: input.operation.cartAfter }, state: input.operation.editState })
    : undefined;
  return result({
    handled: true,
    success: input.operation.success,
    changed: input.operation.changed,
    cartBefore: input.operation.cartBefore,
    cartAfter: input.operation.cartAfter,
    ...(input.operation.editState ? { editState: input.operation.editState } : {}),
    ...(input.operation.review ? { review: input.operation.review } : {}),
    ...(presentation ? { presentation } : {}),
    ...(input.operation.commercialEvaluation ? { commercialEvaluation: input.operation.commercialEvaluation } : {}),
    ...(input.operation.planningResult ? { planningResult: input.operation.planningResult } : {}),
    ...(input.operation.mergedIntoItemId ? { mergedIntoItemId: input.operation.mergedIntoItemId } : {}),
    nextStep: input.operation.success ? input.nextStep || "REVIEW_ITEM_CHANGES" : "BLOCKED",
    failureCode: input.operation.failureCode,
    warnings: input.operation.warnings,
  });
}

/** Preview-only router for detached completed-item option replacement. */
export function runCartItemEditPreview(input: CartItemEditPreviewInput): CartItemEditPreviewResult {
  const cartBefore = cloneCart(input.cart);
  if (!input.previewEnabled) {
    return result({ handled: false, success: false, changed: false, cartBefore });
  }

  const suppliedState = input.editState === undefined ? undefined : normalizeCartItemEditPreviewState(input.editState);
  const hasInvalidState = input.editState !== undefined && !suppliedState;
  const context = contextFor(input, cartBefore);

  if (input.startItemId) {
    if (hasInvalidState) {
      return result({ handled: true, success: false, changed: false, cartBefore, failureCode: "INVALID_ITEM_EDIT_STATE" });
    }
    const operation = startCartItemEdit({
      context,
      itemId: input.startItemId,
      ...(suppliedState ? { activeState: suppliedState } : {}),
      hasCartReviewConflict: input.hasCartReviewConflict,
    });
    const editState = operation.editState && input.startFieldKey
      ? {
          ...operation.editState,
          focusedFieldKey: input.startFieldKey,
          autoSaveOnSelection: true,
        }
      : operation.editState;
    return withEditPresentation({
      context,
      operation: { ...operation, ...(editState ? { editState } : {}) },
      nextStep: "SELECT_ITEM_OPTION",
    });
  }

  if (hasInvalidState) {
    const action = normalizeCartItemEditAction(input.rawActionId);
    if (action.recognized || input.cartReviewText !== undefined) {
      return result({ handled: true, success: false, changed: false, cartBefore, failureCode: "INVALID_ITEM_EDIT_STATE" });
    }
    return result({ handled: false, success: false, changed: false, cartBefore });
  }

  if (suppliedState && input.cartReviewText !== undefined) {
    if (!suppliedState.awaitingTextFieldKey) {
      return result({ handled: false, success: false, changed: false, cartBefore, editState: suppliedState });
    }
    return withEditPresentation({
      context,
      operation: captureCartItemEditText({ context, state: suppliedState, text: input.cartReviewText }),
      nextStep: "REVIEW_ITEM_CHANGES",
    });
  }

  const normalization = normalizeCartItemEditAction(input.rawActionId);
  if (!normalization.recognized) {
    if (!suppliedState) return result({ handled: false, success: false, changed: false, cartBefore });
    const verify = startCartItemEdit({ context, itemId: suppliedState.sourceItemId, activeState: suppliedState });
    return withEditPresentation({ context, operation: verify, nextStep: "REVIEW_ITEM_CHANGES" });
  }
  if (!normalization.valid || !normalization.action) {
    return result({
      handled: true,
      success: false,
      changed: false,
      cartBefore,
      ...(suppliedState ? { editState: suppliedState } : {}),
      failureCode: normalization.failureCode,
    });
  }

  if (!suppliedState) {
    if (normalization.action.type === "SAVE" || normalization.action.type === "CANCEL") {
      const main = mainPresentation({ context, cart: cartBefore });
      return result({
        handled: true,
        success: Boolean(main.presentation),
        changed: false,
        cartBefore,
        ...(main.review ? { review: main.review } : {}),
        ...(main.presentation ? { presentation: main.presentation } : {}),
        ...(main.commercialEvaluation ? { commercialEvaluation: main.commercialEvaluation } : {}),
        nextStep: main.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE" ? "RESOLVE_COMMERCIAL_STATE" : "RETURN_TO_CART_REVIEW",
        warnings: main.warnings,
      });
    }
    return result({ handled: true, success: false, changed: false, cartBefore, failureCode: "PREVIEW_STATE_REQUIRED" });
  }

  if (normalization.action.type === "SELECT_OPTION") {
    const selected = selectCartItemEditOption({
      context,
      state: suppliedState,
      fieldKey: normalization.action.fieldKey,
      canonicalValue: normalization.action.canonicalValue,
    });
    if (selected.success && selected.editState?.autoSaveOnSelection) {
      const saved = saveCartItemEdit({ context, state: selected.editState });
      const main = saved.success ? mainPresentation({ context, cart: saved.cartAfter }) : undefined;
      return result({
        handled: true,
        success: saved.success,
        changed: saved.changed,
        cartBefore: saved.cartBefore,
        cartAfter: saved.cartAfter,
        ...(saved.review ? { review: saved.review } : {}),
        ...(main?.presentation ? { presentation: main.presentation } : {}),
        ...(saved.commercialEvaluation ? { commercialEvaluation: saved.commercialEvaluation } : {}),
        ...(saved.planningResult ? { planningResult: saved.planningResult } : {}),
        ...(saved.mergedIntoItemId ? { mergedIntoItemId: saved.mergedIntoItemId } : {}),
        nextStep: saved.success ? "RETURN_TO_CART_REVIEW" : "BLOCKED",
        failureCode: saved.failureCode,
        warnings: [...saved.warnings, ...(main?.warnings || [])],
      });
    }
    return withEditPresentation({ context, operation: selected, nextStep: "REVIEW_ITEM_CHANGES" });
  }
  if (normalization.action.type === "ENTER_TEXT") {
    return withEditPresentation({
      context,
      operation: beginCartItemEditText({ context, state: suppliedState, fieldKey: normalization.action.fieldKey }),
      nextStep: "ENTER_ITEM_OPTION_TEXT",
    });
  }
  if (normalization.action.type === "CANCEL") {
    const main = mainPresentation({ context, cart: cartBefore });
    return result({
      handled: true,
      success: Boolean(main.presentation),
      changed: false,
      cartBefore,
      ...(main.review ? { review: main.review } : {}),
      ...(main.presentation ? { presentation: main.presentation } : {}),
      ...(main.commercialEvaluation ? { commercialEvaluation: main.commercialEvaluation } : {}),
      nextStep: main.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE" ? "RESOLVE_COMMERCIAL_STATE" : "RETURN_TO_CART_REVIEW",
      warnings: main.warnings,
    });
  }

  const saved = saveCartItemEdit({ context, state: suppliedState });
  const main = saved.success ? mainPresentation({ context, cart: saved.cartAfter }) : undefined;
  return result({
    handled: true,
    success: saved.success,
    changed: saved.changed,
    cartBefore: saved.cartBefore,
    cartAfter: saved.cartAfter,
    ...(saved.review ? { review: saved.review } : {}),
    ...(main?.presentation ? { presentation: main.presentation } : {}),
    ...(saved.commercialEvaluation ? { commercialEvaluation: saved.commercialEvaluation } : {}),
    ...(saved.planningResult ? { planningResult: saved.planningResult } : {}),
    ...(saved.mergedIntoItemId ? { mergedIntoItemId: saved.mergedIntoItemId } : {}),
    nextStep: saved.success
      ? saved.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE"
        ? "RESOLVE_COMMERCIAL_STATE"
        : "RETURN_TO_CART_REVIEW"
      : "BLOCKED",
    failureCode: saved.failureCode,
    warnings: [...saved.warnings, ...(main?.warnings || [])],
  });
}
