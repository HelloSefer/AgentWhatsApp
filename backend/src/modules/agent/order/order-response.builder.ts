import type { OrderEntities } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { ProductContext } from "../product-context.types";
import { dynamicReplyRenderer } from "../reply/dynamic-reply-renderer.service";
import type { RenderedAgentReply } from "../reply/reply-renderer.types";
import {
  calculateOrderTotals,
  formatOrderMoney,
} from "./order-pricing.service";
import type { ResolvedDeliveryQuote } from "./delivery-pricing.service";

const fieldLabels: Record<string, string> = {
  fullName: "الاسم الكامل",
  phone: "رقم الهاتف",
  city: "المدينة",
  address: "العنوان",
  productName: "المنتج",
  variant: "النوع",
  color: "اللون",
  size: "المقاس",
  quantity: "الكمية",
  notes: "ملاحظات",
};
const summaryLabelOverrides: Record<string, string> = {
  fullName: "الاسم",
  phone: "الهاتف",
  city: "المدينة",
  address: "العنوان",
  productName: "المنتج",
  variant: "النوع",
  color: "اللون",
  size: "المقاس",
  quantity: "الكمية",
  notes: "ملاحظات",
};

function toRequiredField(
  key: string,
  index: number,
  requiredFields?: RequiredOrderField[],
): RequiredOrderField {
  const configuredField = requiredFields?.find((field) => field.key === key);

  if (configuredField) {
    return configuredField;
  }

  return {
    key,
    label: fieldLabels[key] || key,
    required: true,
    enabled: true,
    source: "customerField",
    askOrder: index + 1,
  };
}

function resolveMissingFields(
  missingFields: string[],
  requiredFields?: RequiredOrderField[],
): RequiredOrderField[] {
  return missingFields.map((field, index) =>
    toRequiredField(field, index, requiredFields),
  );
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function formatValue(value: unknown): string {
  return typeof value === "number" ? String(value) : String(value).trim();
}

function getProductName(productContext: ProductContext): string | undefined {
  const candidate = productContext as ProductContext & {
    name?: string;
    productName?: string;
  };

  return candidate.productName || candidate.name;
}

function getPriceText(productContext: ProductContext): string | undefined {
  const price = productContext.price;

  if (!hasValue(price)) {
    return undefined;
  }

  const currency = productContext.currency === "MAD" ? "درهم" : productContext.currency;

  return currency ? `${formatValue(price)} ${currency}` : formatValue(price);
}

function buildDeliveryText(productContext: ProductContext): string | undefined {
  if (productContext.deliveryInfo) {
    return productContext.deliveryInfo.replace(/^التوصيل:\s*/i, "");
  }

  const deliveryAreas = productContext.deliveryAreas?.filter(Boolean);

  if (deliveryAreas?.length) {
    return `متوفر ل${deliveryAreas.join("، ")}`;
  }

  return undefined;
}

function buildPaymentText(productContext: ProductContext): string | undefined {
  const payment = productContext.paymentMethods?.find(Boolean);

  if (!payment) {
    return undefined;
  }

  return payment.replace(/^الدفع:\s*/i, "").replace(/^الدفع\s*/i, "");
}

function buildPhase2AOrderSummary(input: {
  collected: OrderEntities;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
  deliveryQuote: ResolvedDeliveryQuote;
}): RenderedAgentReply {
  const lines: string[] = ["راجع تفاصيل الطلب ديالك قبل ما نأكدوه 👇"];
  const productName = getProductName(input.productContext);
  const fields = input.requiredFields?.length
    ? [...input.requiredFields]
    : [
        toRequiredField("size", 0),
        toRequiredField("color", 1),
        toRequiredField("quantity", 2),
        toRequiredField("fullName", 3),
        toRequiredField("phone", 4),
        toRequiredField("city", 5),
        toRequiredField("address", 6),
      ];

  const values = input.collected as Record<string, unknown>;
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const appendSection = (title: string, keys: string[]) => {
    const sectionLines = keys.flatMap((key) => {
      const value = key === "productName" ? productName : values[key];
      const field = fieldByKey.get(key);

      if (!hasValue(value)) {
        return [];
      }

      return [`${summaryLabelOverrides[key] || field?.label || key}: ${formatValue(value)}`];
    });

    if (sectionLines.length) {
      lines.push("", `*${title}*`, ...sectionLines);
    }
  };

  appendSection("الطلب", ["productName", "variant", "size", "color", "quantity"]);
  appendSection("معلومات التوصيل", ["fullName", "phone", "city", "address"]);

  const totals = calculateOrderTotals({
    productContext: input.productContext,
    quantity: input.collected.quantity,
    deliveryQuote: input.deliveryQuote,
  });

  if (totals.unitPrice > 0) {
    lines.push(
      "",
      "*الحساب*",
      `ثمن الوحدة: ${formatOrderMoney(totals.unitPrice)} ${totals.currency}`,
      `ثمن المنتجات: ${formatOrderMoney(totals.subtotal)} ${totals.currency}`,
      `مصاريف التوصيل: ${totals.deliveryPriceLabel}`,
      `المجموع: ${formatOrderMoney(totals.total)} ${totals.currency}`,
    );
  }

  const reviewText = lines.join("\n");
  const ctaText = "واش المعلومات كلها صحيحة؟";
  const fallbackText =
    'كتب "نعم" باش نأكد الطلب، أو "تعديل" باش تبدل شي معلومة.';
  const buttons = [
    { id: "order:confirm" as const, label: "نأكد الطلب" },
    { id: "order:edit" as const, label: "نبدل شي حاجة" },
  ];

  return {
    text: reviewText,
    ui: {
      kind: "buttons",
      purpose: "confirmation",
      title: "تأكيد الطلب",
      body: ctaText,
      options: buttons.map((button) => ({
        ...button,
        value: button.id === "order:confirm" ? "نعم" : "تعديل",
      })),
    },
    presentation: {
      presentationMode: "split_order_review_and_confirmation",
      messages: [
        { kind: "text", text: reviewText },
        {
          kind: "interactive_buttons",
          text: ctaText,
          fallbackText,
          buttons,
        },
      ],
    },
  };
}

export function renderOrderProgressReply(input: {
  collected: OrderEntities;
  missingFields: string[];
  isComplete: boolean;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
  deliveryQuote?: ResolvedDeliveryQuote;
}): RenderedAgentReply {
  if (input.isComplete) {
    if (!input.deliveryQuote) {
      throw new Error("Resolved delivery quote is required for final order review");
    }

    return buildPhase2AOrderSummary({
      collected: input.collected,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
      deliveryQuote: input.deliveryQuote,
    });
  }

  const missingFields = resolveMissingFields(
    input.missingFields,
    input.requiredFields,
  );

  const hasCollectedFields = Object.values(input.collected).some(hasValue);

  return hasCollectedFields
    ? dynamicReplyRenderer.renderMissingFields({ missingFields })
    : dynamicReplyRenderer.renderOrderStart({ missingFields });
}

export function buildOrderProgressReply(input: {
  collected: OrderEntities;
  missingFields: string[];
  isComplete: boolean;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
  deliveryQuote?: ResolvedDeliveryQuote;
}): string {
  return renderOrderProgressReply(input).text;
}

export function buildOrderConfirmationSuccessReply(): string {
  return dynamicReplyRenderer.renderConfirmationSuccess().text;
}

export function renderOrderConfirmationSuccessReply(): RenderedAgentReply {
  return dynamicReplyRenderer.renderConfirmationSuccess();
}
