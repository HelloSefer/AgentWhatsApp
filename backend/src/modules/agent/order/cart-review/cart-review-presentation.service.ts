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

function itemOrdinal(index: number): string {
  const ordinals = [
    "الأولى",
    "الثانية",
    "الثالثة",
    "الرابعة",
    "الخامسة",
    "السادسة",
    "السابعة",
    "الثامنة",
    "التاسعة",
    "العاشرة",
  ];

  return ordinals[index] || `رقم ${index + 1}`;
}

function itemDescription(item: CartReviewItemSnapshot): string {
  return item.options
    .map((option) => `${option.label}: ${String(option.value)}`)
    .join(" — ");
}

/** Platform-neutral review controls only; transport payloads are built elsewhere. */
export function buildCartReviewPresentation(
  _review: CartReviewSnapshot,
  conversationalProductName?: string,
): CartReviewPresentationResult {
  const addItemLabel = conversationalProductName?.trim()
    ? `زيد ${conversationalProductName.trim()}`
    : "زيد قطعة";
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "cart_review",
    body: "مزيان 👌 السلة ديالك واجدة.",
    options: [
      { id: "cart_review:continue", label: "كمل الطلب" },
      { id: "cart_review:add_item", label: addItemLabel },
      { id: "cart_review:edit", label: "عدل السلة" },
    ],
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "CART_REVIEW",
    promptKey: "CART_REVIEW",
    text: "مزيان 👌 السلة ديالك واجدة.",
    uiHints,
  });
}

export function buildCartReviewItemSelectorPresentation(
  review: CartReviewSnapshot,
  conversationalProductName?: string,
): CartReviewPresentationResult {
  const productName = conversationalProductName?.trim() || "المنتج";
  const uiHints: AgentReplyUiHint = {
    kind: "list",
    purpose: "cart_review",
    title: "اختار القطعة",
    buttonText: "اختار",
    body: "شنو بغيتي تعدل؟",
    options: review.items.map((item, index) => ({
      id: `cart_review_item:select:${item.id}`,
      label: `${productName} ${itemOrdinal(index)}`,
      value: itemDescription(item),
    })),
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "ITEM_SELECTOR",
    promptKey: "SELECT_CART_ITEM",
    text: "شنو بغيتي تعدل؟",
    uiHints,
  });
}

export function buildCartReviewItemActionsPresentation(
  item: CartReviewItemSnapshot,
): CartReviewPresentationResult {
  const optionButtons = item.options
    .filter((option) => option.key === "size" || option.key === "color")
    .map((option) => ({
      id: `cart_review_item:option:${option.key}:${item.id}`,
      label: option.label,
    }));
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "cart_review",
    body: "شنو بغيتي تبدل؟",
    options: [
      ...optionButtons,
      { id: `cart_review_item:remove:${item.id}`, label: "حذف من السلة" },
    ],
    previewOnly: true,
  };
  return result({
    success: true,
    kind: "ITEM_ACTIONS",
    promptKey: "CART_ITEM_ACTIONS",
    text: "شنو بغيتي تبدل؟",
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
