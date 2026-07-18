import type { AgentReplyUiHint } from "../../reply/reply-renderer.types";
import type {
  CartReviewItemSnapshot,
  CartReviewPresentationResult,
  CartReviewSnapshot,
} from "./cart-review.types";

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

function itemLabel(item: CartReviewItemSnapshot): string {
  const optionText = item.options
    .map((option) => `${option.label}: ${String(option.value)}`)
    .join("، ");
  return optionText ? `${optionText} — ${item.quantity}` : `قطعة — ${item.quantity}`;
}

/** Platform-neutral review controls only; transport payloads are built elsewhere. */
export function buildCartReviewPresentation(
  review: CartReviewSnapshot,
): CartReviewPresentationResult {
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "cart_review",
    body: `عندك ${review.completedUnits} قطعة واجدة للمراجعة`,
    options: [
      { id: "cart_review:continue", label: "كمل الطلب" },
      { id: "cart_review:add_item", label: "زيد قطعة" },
      { id: "cart_review:edit", label: "عدل السلة" },
    ],
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "CART_REVIEW",
    promptKey: "CART_REVIEW",
    text: "راجع السلة ديالك قبل ما نكملو",
    uiHints,
  });
}

export function buildCartReviewItemSelectorPresentation(
  review: CartReviewSnapshot,
): CartReviewPresentationResult {
  const uiHints: AgentReplyUiHint = {
    kind: "list",
    purpose: "cart_review",
    title: "اختار القطعة",
    body: "اختار القطعة اللي بغيتي تعدل",
    options: review.items.map((item) => ({
      id: `cart_review_item:select:${item.id}`,
      label: itemLabel(item),
      value: item.id,
    })),
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "ITEM_SELECTOR",
    promptKey: "SELECT_CART_ITEM",
    text: "اختار قطعة من السلة",
    uiHints,
  });
}

export function buildCartReviewItemActionsPresentation(
  item: CartReviewItemSnapshot,
): CartReviewPresentationResult {
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "cart_review",
    body: itemLabel(item),
    options: [
      { id: `cart_review_item:quantity:${item.id}`, label: "بدل الكمية" },
      { id: `cart_review_item:remove:${item.id}`, label: "حيد القطعة" },
      { id: "cart_review:back", label: "رجوع" },
    ],
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "ITEM_ACTIONS",
    promptKey: "CART_ITEM_ACTIONS",
    text: "شنو بغيتي دير بهاد القطعة؟",
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
    text: `دخل الكمية الجديدة لهاد القطعة (دابا: ${item.quantity})`,
    selectedItemId: item.id,
  });
}

export function buildCommercialResolutionPresentation(): CartReviewPresentationResult {
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "cart_review",
    body: "العرض المختار ما بقاش مناسب لهاد السلة",
    options: [{ id: "cart_review:use_standard", label: "اعتمد الثمن العادي" }],
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "CART_REVIEW",
    promptKey: "RESOLVE_COMMERCIAL_STATE",
    text: "خاصك تختار الثمن العادي قبل ما نكملو",
    uiHints,
  });
}
