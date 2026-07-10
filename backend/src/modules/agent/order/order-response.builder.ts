import type { OrderEntities } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { ProductContext } from "../product-context.types";
import { dynamicReplyRenderer } from "../reply/dynamic-reply-renderer.service";
import type { RenderedAgentReply } from "../reply/reply-renderer.types";

const fieldLabels: Record<string, string> = {
  fullName: "الاسم الكامل",
  phone: "رقم الهاتف",
  city: "المدينة",
  address: "العنوان",
  productName: "المنتوج",
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
  productName: "المنتوج",
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
}): RenderedAgentReply {
  const lines: string[] = ["هذا ملخص الطلب ديالك:", ""];
  const productName = getProductName(input.productContext);
  const price = getPriceText(input.productContext);
  const delivery = buildDeliveryText(input.productContext);
  const payment = buildPaymentText(input.productContext);
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

  if (productName) {
    lines.push(`المنتج: ${productName}`);
  }

  for (const field of fields) {
    const value = (input.collected as Record<string, unknown>)[field.key];

    if (hasValue(value)) {
      lines.push(`${summaryLabelOverrides[field.key] || field.label}: ${formatValue(value)}`);
    }
  }

  if (price) {
    lines.push("", `الثمن: ${price}`);
  }

  if (delivery) {
    lines.push(`التوصيل: ${delivery}`);
  }

  if (payment) {
    lines.push(`الدفع: ${payment}`);
  }

  lines.push(
    "",
    "الطلب واجد للمراجعة ✅",
    "مرحلة التأكيد النهائي غادي تتفعل في المرحلة الجاية.",
  );

  return {
    text: lines.join("\n"),
    ui: {
      kind: "none",
      purpose: "confirmation",
    },
  };
}

export function renderOrderProgressReply(input: {
  collected: OrderEntities;
  missingFields: string[];
  isComplete: boolean;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
}): RenderedAgentReply {
  if (input.isComplete) {
    return buildPhase2AOrderSummary({
      collected: input.collected,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
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
}): string {
  return renderOrderProgressReply(input).text;
}

export function buildOrderConfirmationSuccessReply(): string {
  return dynamicReplyRenderer.renderConfirmationSuccess().text;
}

export function renderOrderConfirmationSuccessReply(): RenderedAgentReply {
  return dynamicReplyRenderer.renderConfirmationSuccess();
}
