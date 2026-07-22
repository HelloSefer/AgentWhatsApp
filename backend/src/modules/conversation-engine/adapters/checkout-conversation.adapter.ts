import type { ProductContext } from "../../agent/config/product-context.types";
import type { FinalOrderReview } from "../../agent/order/delivery-confirmation/delivery-confirmation.types";
import type { OrderConfirmationPresentation } from "../../agent/reply/reply-renderer.types";
import { composeConversationFragment } from "../rendering/conversation-renderer.service";
import { arMaItemOrdinal } from "../locales/ar-MA/formatters";
import { deliveryLabel, deliveryMessage } from "./delivery-conversation.adapter";
import { resolveProductConversationWording } from "./product-wording.adapter";

function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function currencyLabel(currency: string): string {
  return currency.trim().toUpperCase() === "MAD"
    ? deliveryLabel("checkout.currency_mad")
    : safeText(currency);
}

function formatMinor(valueMinor: number, currency: string): string {
  const value = valueMinor / 100;
  const amount = Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.00$/, "");
  return `${amount} ${currencyLabel(currency)}`;
}

function renderItem(
  item: FinalOrderReview["items"][number],
  index: number,
  productConversationalName: string,
): string {
  const heading = deliveryMessage("checkout.item_heading", {
    productConversationalName,
    itemOrdinal: arMaItemOrdinal(index),
  });
  const options = item.options.map((option) => deliveryMessage("checkout.option_line", {
    optionLabel: safeText(option.label),
    optionValue: safeText(option.value),
  }));
  return composeConversationFragment([heading, ...options]);
}

function deliveryFieldLabel(field: FinalOrderReview["orderFields"][number]): string {
  if (field.key === "fullName") return deliveryLabel("delivery.full_name");
  if (field.key === "phone") return deliveryLabel("delivery.phone");
  if (field.key === "city") return deliveryLabel("delivery.city");
  if (field.key === "address") return deliveryLabel("delivery.address");
  return safeText(field.label);
}

/** Presentation adapter over authoritative checkout data; it never mutates the review. */
export function renderCheckoutReview(
  review: FinalOrderReview,
  productContext?: Partial<Pick<ProductContext, "name" | "conversationalName" | "singularName" | "pluralName">>,
): {
  text: string;
  confirmationText: string;
  fallbackText: string;
  presentation: OrderConfirmationPresentation;
} {
  const wording = resolveProductConversationWording(productContext || {
    name: review.items[0]?.productName,
  });
  const physicalItems = review.items.flatMap((item) =>
    Array.from({ length: item.quantity }, () => item),
  );
  const itemLines = physicalItems.map((item, index) =>
    renderItem(item, index, wording.conversationalName),
  );
  const deliveryLines = review.orderFields.map((field) => deliveryMessage("checkout.delivery_line", {
    fieldLabel: deliveryFieldLabel(field),
    fieldValue: safeText(field.value),
  }));
  const totals = [
    deliveryMessage("checkout.products_total", {
      productPluralName: wording.pluralName,
      productsSubtotal: formatMinor(review.merchandiseTotalMinor, review.currency),
    }),
    review.deliveryFee?.type === "FREE"
      ? deliveryMessage("checkout.delivery_free")
      : review.deliveryFee
        ? deliveryMessage("checkout.delivery_paid", {
            deliveryAmount: formatMinor(review.deliveryFee.amountMinor, review.deliveryFee.currency),
          })
        : deliveryMessage("checkout.delivery_unspecified"),
    deliveryMessage("checkout.final_total", {
      finalTotal: formatMinor(review.finalTotalMinor, review.currency),
    }),
  ];

  const text = [
    deliveryMessage("checkout.final_review_intro"),
    "",
    itemLines.join("\n\n"),
    "",
    deliveryMessage("checkout.delivery_section"),
    ...deliveryLines,
    "",
    deliveryMessage("checkout.totals_section"),
    ...totals,
  ].join("\n");
  const confirmationText = deliveryMessage("checkout.confirmation_question");
  const buttons = [
    { id: "order_checkout:confirm", label: deliveryLabel("checkout.confirm") },
    { id: "order_checkout:back_to_cart", label: deliveryLabel("checkout.edit_order") },
    { id: "order_checkout:edit_delivery", label: deliveryLabel("checkout.edit_delivery") },
  ];
  const fallbackText = [
    confirmationText,
    ...buttons.map((button) => `- ${button.label}`),
  ].join("\n");

  return {
    text,
    confirmationText,
    fallbackText,
    presentation: {
      presentationMode: "split_order_review_and_confirmation",
      messages: [
        { kind: "text", text },
        { kind: "interactive_buttons", text: confirmationText, fallbackText, buttons },
      ],
    },
  };
}
