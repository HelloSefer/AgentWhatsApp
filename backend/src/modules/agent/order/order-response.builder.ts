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

export function renderOrderProgressReply(input: {
  collected: OrderEntities;
  missingFields: string[];
  isComplete: boolean;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
}): RenderedAgentReply {
  if (input.isComplete) {
    return dynamicReplyRenderer.renderOrderSummary({
      collected: input.collected as Record<string, unknown>,
      requiredFields: input.requiredFields || [],
      quantity: input.collected.quantity,
    });
  }

  const missingFields = resolveMissingFields(
    input.missingFields,
    input.requiredFields,
  );
  const collectedLabels = dynamicReplyRenderer.getCollectedLabels({
    collected: input.collected as Record<string, unknown>,
    requiredFields: input.requiredFields || [],
    quantity: input.collected.quantity,
  });

  if (collectedLabels.length) {
    return dynamicReplyRenderer.renderMissingFields({
      collectedLabels,
      missingFields,
    });
  }

  return dynamicReplyRenderer.renderOrderStart({ missingFields });
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
