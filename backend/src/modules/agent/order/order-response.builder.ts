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

export function buildOrderProgressReply(input: {
  collected: OrderEntities;
  missingFields: string[];
  isComplete: boolean;
  productContext: ProductContext;
}): string {
  if (input.isComplete) {
    return "تمام، توصلت بجميع معلومات الطلب. غادي نأكد لك الطلب دابا.";
  }

  const missingFieldsText = formatMissingFields(input.missingFields);
  const collectedSummary = buildCollectedSummary(input.collected);

  if (collectedSummary) {
    return `مزيان، توصلت ب${collectedSummary}. باقي عافاك صيفط ليا ${missingFieldsText} باش نأكد لك الطلب.`;
  }

  return `مرحبا، عافاك صيفط ليا ${missingFieldsText} باش نأكد لك الطلب.`;
}
