import type { AgentReplyUiHint } from "../../reply/reply-renderer.types";
import type {
  CartReviewItemSnapshot,
  CartReviewPresentationResult,
  CartReviewSnapshot,
} from "./cart-review.types";
import {
  cartLabel,
  cartMessage,
} from "../../../conversation-engine/adapters/cart-conversation.adapter";
import { arMaItemOrdinal } from "../../../conversation-engine/locales/ar-MA/formatters";
import { commonLabel } from "../../../conversation-engine/adapters/common-conversation.adapter";

function cloneUiHints(uiHints: AgentReplyUiHint): AgentReplyUiHint {
  return { ...uiHints, options: uiHints.options?.map((option) => ({ ...option })) };
}

function result(input: Omit<CartReviewPresentationResult, "warnings"> & { warnings?: string[] }): CartReviewPresentationResult {
  return {
    ...input,
    ...(input.uiHints ? { uiHints: cloneUiHints(input.uiHints) } : {}),
    warnings: [...(input.warnings || [])],
  };
}

function itemDescription(item: CartReviewItemSnapshot): string {
  return item.options
    .map((option) => cartMessage("cart.item_option_description", {
      optionLabel: option.label,
      optionValue: String(option.value),
    }))
    .join(" — ");
}

/** Platform-neutral review controls only; transport payloads are built elsewhere. */
export function buildCartReviewPresentation(
  _review: CartReviewSnapshot,
  conversationalProductName?: string,
): CartReviewPresentationResult {
  const addItemLabel = cartLabel("cart.add_item", {
    productConversationalName: conversationalProductName?.trim() || commonLabel("common.piece"),
  });
  const body = cartMessage("cart.review_ready");
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "cart_review",
    body,
    options: [
      { id: "cart_review:continue", label: cartLabel("cart.continue") },
      { id: "cart_review:add_item", label: addItemLabel },
      { id: "cart_review:edit", label: cartLabel("cart.edit") },
    ],
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "CART_REVIEW",
    promptKey: "CART_REVIEW",
    text: body,
    uiHints,
  });
}

export function buildCartReviewItemSelectorPresentation(
  review: CartReviewSnapshot,
  conversationalProductName?: string,
): CartReviewPresentationResult {
  const productName = conversationalProductName?.trim() || commonLabel("common.product");
  const body = cartMessage("cart.select_item_to_edit");
  const uiHints: AgentReplyUiHint = {
    kind: "list",
    purpose: "cart_review",
    title: cartLabel("cart.select_item_title"),
    buttonText: cartLabel("cart.select_button"),
    body,
    options: review.items.map((item, index) => ({
      id: `cart_review_item:select:${item.id}`,
      label: cartMessage("cart.item_row_title", {
        productConversationalName: productName,
        itemOrdinal: arMaItemOrdinal(index),
      }),
      value: itemDescription(item),
    })),
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "ITEM_SELECTOR",
    promptKey: "SELECT_CART_ITEM",
    text: body,
    uiHints,
  });
}

export function buildCartReviewItemActionsPresentation(
  item: CartReviewItemSnapshot,
): CartReviewPresentationResult {
  const optionButtons = item.options.map((option) => ({
      id: `cart_review_item:option:${option.key}:${item.id}`,
      label: option.label,
    }));
  const body = cartMessage("cart.select_field_to_edit");
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "cart_review",
    body,
    options: [
      ...optionButtons,
      { id: `cart_review_item:remove:${item.id}`, label: cartLabel("cart.remove") },
    ],
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "ITEM_ACTIONS",
    promptKey: "CART_ITEM_ACTIONS",
    text: body,
    selectedItemId: item.id,
    uiHints,
  });
}

export function buildCartReviewQuantityInputPresentation(
  item: CartReviewItemSnapshot,
): CartReviewPresentationResult {
  return result({
    success: true,
    kind: "QUANTITY_INPUT",
    promptKey: "EDIT_CART_ITEM_QUANTITY",
    text: cartMessage("cart.quantity_edit", { quantity: item.quantity }),
    selectedItemId: item.id,
  });
}

export function buildCommercialResolutionPresentation(): CartReviewPresentationResult {
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "cart_review",
    body: cartMessage("cart.commercial_resolution_body"),
    options: [{ id: "cart_review:use_standard", label: cartLabel("cart.use_standard") }],
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "CART_REVIEW",
    promptKey: "RESOLVE_COMMERCIAL_STATE",
    text: cartMessage("cart.commercial_resolution_text"),
    uiHints,
  });
}
