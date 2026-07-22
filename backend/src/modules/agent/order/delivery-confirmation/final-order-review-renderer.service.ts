import type { OrderConfirmationPresentation } from "../../reply/reply-renderer.types";
import type { ProductContext } from "../../config/product-context.types";
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
  conversationalProductName?: string,
): string {
  const ordinals = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
  const options = item.options.map(
    (option) => `• ${safeText(option.label)}: ${safeText(option.value)}`,
  );

  return [
    `${safeText(conversationalProductName || item.productName)} ${ordinals[index] || `رقم ${index + 1}`}:`,
    ...options,
  ].join("\n");
}

function deliveryFieldLabel(field: FinalOrderReview["orderFields"][number]): string {
  const standardLabels: Record<string, string> = {
    fullName: "الاسم",
    phone: "الهاتف",
    city: "المدينة",
    address: "العنوان",
  };
  return standardLabels[field.key] || safeText(field.label);
}

/** Renders only detached Phase 6.3F review data; no request or session values. */
export function renderFinalOrderReview(
  review: FinalOrderReview,
  productContext?: Pick<ProductContext, "conversationalName" | "pluralName">,
): {
  text: string;
  confirmationText: string;
  fallbackText: string;
  presentation: OrderConfirmationPresentation;
} {
  const itemLines = review.items.map((item, index) =>
    renderItem(item, index, productContext?.conversationalName),
  );
  const deliveryLines = review.orderFields.map(
    (field) => `• ${deliveryFieldLabel(field)}: ${safeText(field.value)}`,
  );
  const productPluralName = safeText(productContext?.pluralName || review.items[0]?.productName || "المنتجات");
  const totals = [
    `• ثمن ${productPluralName}: ${formatMinor(review.merchandiseTotalMinor, review.currency)}`,
    `• التوصيل: ${review.deliveryFee?.type === "FREE"
      ? "مجاني"
      : review.deliveryFee
        ? formatMinor(review.deliveryFee.amountMinor, review.deliveryFee.currency)
        : "غير مذكور"}`,
    `• المجموع: ${formatMinor(review.finalTotalMinor, review.currency)}`,
  ];

  const text = [
    "هاهو الطلب ديالك 👇",
    "راجعو مزيان قبل التأكيد.",
    "",
    itemLines.join("\n\n"),
    "",
    "معلومات التوصيل:",
    ...deliveryLines,
    "",
    "الحساب:",
    ...totals,
  ].join("\n");
  const confirmationText = "واش نأكد ليك الطلب، ولا بغيتي تعدل شي حاجة؟";
  const buttons = [
    { id: "order_checkout:confirm", label: "تأكيد الطلب" },
    { id: "order_checkout:back_to_cart", label: "تعديل الطلب" },
    { id: "order_checkout:edit_delivery", label: "تعديل التوصيل" },
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
