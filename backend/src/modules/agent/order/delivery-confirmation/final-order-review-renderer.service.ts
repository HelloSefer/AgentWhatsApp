import type { OrderConfirmationPresentation } from "../../reply/reply-renderer.types";
import type { FinalOrderReview } from "./delivery-confirmation.types";

function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function currencyLabel(currency: string): string {
  return currency.trim().toUpperCase() === "MAD" ? "درهم" : safeText(currency);
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
  currency: string,
): string {
  const options = item.options.map(
    (option) => `   ${safeText(option.label)}: ${safeText(option.value)}`,
  );

  return [
    `${index + 1}) ${safeText(item.productName)}`,
    ...options,
    `   الكمية: ${item.quantity}`,
    `   ثمن الوحدة: ${formatMinor(item.unitPriceMinor, currency)}`,
    `   المجموع: ${formatMinor(item.lineTotalMinor, currency)}`,
  ].join("\n");
}

/** Renders only detached Phase 6.3F review data; no request or session values. */
export function renderFinalOrderReview(review: FinalOrderReview): {
  text: string;
  confirmationText: string;
  fallbackText: string;
  presentation: OrderConfirmationPresentation;
} {
  const itemLines = review.items.map((item, index) =>
    renderItem(item, index, review.currency),
  );
  const deliveryLines = review.orderFields.map(
    (field) => `${safeText(field.label)}: ${safeText(field.value)}`,
  );
  const totals = [
    `المجموع قبل العرض: ${formatMinor(review.standardSubtotalMinor, review.currency)}`,
  ];

  if (review.selectedOffer) {
    totals.push(`العرض: ${safeText(review.selectedOffer.label || "العرض المختار")}`);
    totals.push(`التخفيض: ${formatMinor(review.selectedOffer.discountMinor, review.currency)}`);
    totals.push(`مجموع المنتجات بعد العرض: ${formatMinor(review.merchandiseTotalMinor, review.currency)}`);
  }

  if (review.deliveryFee) {
    totals.push(
      review.deliveryFee.type === "FREE"
        ? "التوصيل: مجاني"
        : `التوصيل: ${formatMinor(review.deliveryFee.amountMinor, review.deliveryFee.currency)}`,
    );
  }
  totals.push(`المجموع النهائي: ${formatMinor(review.finalTotalMinor, review.currency)}`);

  const text = [
    "راجع الطلب ديالك قبل التأكيد:",
    "",
    "المنتجات:",
    "",
    itemLines.join("\n\n"),
    "",
    "معلومات التوصيل:",
    ...deliveryLines,
    "",
    ...totals,
  ].join("\n");
  const confirmationText = "واش نأكد لك الطلب ولا بغيتي تبدل شي حاجة؟";
  const buttons = [
    { id: "order_checkout:confirm", label: "أكد الطلب" },
    { id: "order_checkout:back_to_cart", label: "بدل المنتجات" },
    { id: "order_checkout:edit_delivery", label: "بدل التوصيل" },
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
        {
          kind: "interactive_buttons",
          text: confirmationText,
          fallbackText,
          buttons,
        },
      ],
    },
  };
}
