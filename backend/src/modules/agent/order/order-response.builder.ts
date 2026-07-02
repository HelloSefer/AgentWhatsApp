import type { OrderEntities } from "../agent-brain.types";
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

function formatMissingFields(missingFields: string[]): string {
  return formatList(
    missingFields.map((field) => fieldLabels[field as keyof OrderEntities] || field),
  );
}

function buildCollectedSummary(collected: OrderEntities): string {
  const collectedParts: string[] = [];

  if (collected.size) {
    collectedParts.push(`المقاس ${collected.size}`);
  }

  if (collected.color) {
    collectedParts.push(`اللون ${collected.color}`);
  }

  if (collected.city) {
    collectedParts.push(`المدينة ${collected.city}`);
  }

  if (collected.fullName) {
    collectedParts.push(`الاسم ${collected.fullName}`);
  }

  if (collected.phone) {
    collectedParts.push(`رقم الهاتف`);
  }

  if (collected.address) {
    collectedParts.push(`العنوان`);
  }

  if (collected.quantity) {
    collectedParts.push(`الكمية ${collected.quantity}`);
  }

  return collectedParts.length ? formatList(collectedParts) : "";
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function formatOrderValue(value: OrderEntities[keyof OrderEntities]): string {
  return typeof value === "number" ? String(value) : String(value).trim();
}

function buildOrderSummaryLines(collected: OrderEntities): string[] {
  return summaryFieldOrder.flatMap((field) => {
    const value = collected[field];

    if (!hasValue(value)) {
      return [];
    }

    return `${summaryFieldLabels[field]}: ${formatOrderValue(value)}`;
  });
}

function buildOrderConfirmationPrompt(collected: OrderEntities): string {
  const summaryLines = buildOrderSummaryLines(collected);

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
}): string {
  if (input.isComplete) {
    return buildOrderConfirmationPrompt(input.collected);
  }

  const missingFieldsText = formatMissingFields(input.missingFields);
  const collectedSummary = buildCollectedSummary(input.collected);

  if (collectedSummary) {
    return `مزيان، توصلت ب${collectedSummary}. باقي عافاك صيفط ليا ${missingFieldsText} باش نأكد لك الطلب.`;
  }

  return `مرحبا، عافاك صيفط ليا ${missingFieldsText} باش نأكد لك الطلب.`;
}
