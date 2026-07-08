import type { OrderEntities } from "../agent-brain.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { ProductContext } from "../product-context.types";

const fieldLabels: Record<keyof OrderEntities, string> = {
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

const summaryFieldLabels: Record<keyof OrderEntities, string> = {
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

const summaryFieldOrder: Array<keyof OrderEntities> = [
  "fullName",
  "phone",
  "city",
  "address",
  "size",
  "color",
  "quantity",
  "productName",
  "variant",
  "notes",
];

function formatList(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join("، ")} و${items[items.length - 1]}`;
}

function getFieldLabel(
  field: string,
  requiredFields: RequiredOrderField[] | undefined,
  fallbackLabels: Record<keyof OrderEntities, string>,
): string {
  return (
    requiredFields?.find((requiredField) => requiredField.key === field)?.label ||
    fallbackLabels[field as keyof OrderEntities] ||
    field
  );
}

function formatMissingFields(
  missingFields: string[],
  requiredFields?: RequiredOrderField[],
): string {
  return formatList(
    missingFields.map((field) =>
      getFieldLabel(field, requiredFields, fieldLabels),
    ),
  );
}

function buildCollectedSummary(
  collected: OrderEntities,
  requiredFields?: RequiredOrderField[],
): string {
  const collectedParts: string[] = [];
  const requiredFieldKeys = new Set(requiredFields?.map((field) => field.key) || []);
  const allowedKeys = requiredFields?.length
    ? new Set([...requiredFieldKeys, "quantity"])
    : undefined;

  if ((!allowedKeys || allowedKeys.has("size")) && collected.size) {
    collectedParts.push(`المقاس ${collected.size}`);
  }

  if ((!allowedKeys || allowedKeys.has("color")) && collected.color) {
    collectedParts.push(`اللون ${collected.color}`);
  }

  if ((!allowedKeys || allowedKeys.has("city")) && collected.city) {
    collectedParts.push(`المدينة ${collected.city}`);
  }

  if ((!allowedKeys || allowedKeys.has("fullName")) && collected.fullName) {
    collectedParts.push(`الاسم ${collected.fullName}`);
  }

  if ((!allowedKeys || allowedKeys.has("phone")) && collected.phone) {
    collectedParts.push(`رقم الهاتف`);
  }

  if ((!allowedKeys || allowedKeys.has("address")) && collected.address) {
    collectedParts.push(`العنوان`);
  }

  if ((!allowedKeys || allowedKeys.has("quantity")) && collected.quantity) {
    collectedParts.push(`الكمية ${collected.quantity}`);
  }

  for (const field of requiredFields || []) {
    if (summaryFieldOrder.includes(field.key as keyof OrderEntities)) {
      continue;
    }

    const value = (collected as Record<string, unknown>)[field.key];

    if (hasValue(value)) {
      collectedParts.push(`${field.label} ${formatOrderValue(value)}`);
    }
  }

  return collectedParts.length ? formatList(collectedParts) : "";
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function formatOrderValue(value: unknown): string {
  return typeof value === "number" ? String(value) : String(value).trim();
}

function buildOrderSummaryLines(
  collected: OrderEntities,
  requiredFields?: RequiredOrderField[],
): string[] {
  const collectedRecord = collected as Record<string, unknown>;
  const dynamicFields = requiredFields?.length
    ? [
        ...requiredFields,
        ...(hasValue(collected.quantity) && !requiredFields.some((field) => field.key === "quantity")
          ? [
              {
                key: "quantity",
                label: summaryFieldLabels.quantity,
              } as RequiredOrderField,
            ]
          : []),
      ]
    : summaryFieldOrder.map(
        (field, index) =>
          ({
            key: field,
            label: summaryFieldLabels[field],
            required: true,
            enabled: true,
            source: "customerField",
            askOrder: index + 1,
          }) as RequiredOrderField,
      );

  return dynamicFields.flatMap((field) => {
    const value = collectedRecord[field.key];

    if (!hasValue(value)) {
      return [];
    }

    const label =
      summaryFieldLabels[field.key as keyof OrderEntities] || field.label;

    return `${label}: ${formatOrderValue(value)}`;
  });
}

function buildOrderConfirmationPrompt(
  collected: OrderEntities,
  requiredFields?: RequiredOrderField[],
): string {
  const summaryLines = buildOrderSummaryLines(collected, requiredFields);

  if (!summaryLines.length) {
    return "تمام، توصلت بجميع معلومات الطلب.\n\nواش نأكد لك الطلب؟";
  }

  return [
    "تمام، توصلت بجميع معلومات الطلب.",
    "",
    "هذا هو الطلب ديالك:",
    ...summaryLines,
    "",
    "واش نأكد لك الطلب؟",
  ].join("\n");
}

export function buildOrderProgressReply(input: {
  collected: OrderEntities;
  missingFields: string[];
  isComplete: boolean;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
}): string {
  if (input.isComplete) {
    return buildOrderConfirmationPrompt(input.collected, input.requiredFields);
  }

  const missingFieldsText = formatMissingFields(
    input.missingFields,
    input.requiredFields,
  );
  const collectedSummary = buildCollectedSummary(
    input.collected,
    input.requiredFields,
  );

  if (collectedSummary) {
    return `مزيان، توصلت ب${collectedSummary}. باقي عافاك صيفط ليا ${missingFieldsText} باش نأكد لك الطلب.`;
  }

  return `أكيد، صيفط ليا ${missingFieldsText} باش نوجد لك الطلب.`;
}
