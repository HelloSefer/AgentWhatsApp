import type { OrderEntities } from "../agent-brain.types";
import type { ProductContext } from "../product-context.types";

type OrderFieldValidationDiagnostics = {
  totalOrderFieldInvalidCandidatesRejected: number;
  totalOrderFieldInvalidExistingCleared: number;
  totalOrderConfirmationBlockedInvalidFields: number;
  totalReceiptSkippedInvalidOrderFields: number;
};

const diagnostics: OrderFieldValidationDiagnostics = {
  totalOrderFieldInvalidCandidatesRejected: 0,
  totalOrderFieldInvalidExistingCleared: 0,
  totalOrderConfirmationBlockedInvalidFields: 0,
  totalReceiptSkippedInvalidOrderFields: 0,
};

const actionPhrases = [
  "صيفط ليا الصور",
  "الصور",
  "نشوف الصور",
  "صيفط الصور",
  "شنو المقاسات",
  "المقاسات",
  "السايزات",
  "بغيت نكومندي",
  "بغيت نكوموندي",
  "نكومندي",
  "نكوموندي",
  "نطلب",
  "نعم",
  "لا",
  "لا شكرا",
  "لا شكراً",
  "اكد",
  "أكد",
  "نبدل",
  "بدل",
  "الغاء",
  "إلغاء",
  "الثمن",
  "السعر",
  "شحال",
  "show_images",
  "show_sizes",
  "start_order",
  "order_confirm_yes",
  "order_confirm_no",
  "order_confirm_edit",
  "bghit ncommande",
  "bghit nkomandi",
  "ncommande",
  "nkomandi",
  "swr",
  "tsawr",
  "pics",
  "price",
  "taman",
  "ch7al",
  "chhal",
  "l9yasat",
  "sizes",
  "livraison",
  "payment",
  "disponible",
];

const productOnlyWords = [
  "الطلب",
  "طلب",
  "كومند",
  "كوموند",
  "commande",
  "order",
  "المنتوج",
  "المنتج",
  "الصندالة",
  "صندالة",
];

const colorAliases = [
  "أسود",
  "اسود",
  "كحل",
  "كحلة",
  "noir",
  "black",
  "وردي",
  "الوردي",
  "rose",
  "pink",
];

function logJson(payload: Record<string, unknown>) {
  console.log(JSON.stringify(payload));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparable(text: string): string {
  return normalizeText(text).replace(/^ال/, "");
}

function maskPhone(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > 6
    ? `${value.slice(0, 3)}***${value.slice(-3)}`
    : "***";
}

function previewValue(value: unknown, field?: keyof OrderEntities): unknown {
  if (field === "phone" && typeof value === "string") {
    return maskPhone(value);
  }

  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > 50 ? `${normalized.slice(0, 50)}...` : normalized;
}

function isPhoneLike(value: string): boolean {
  return /^(?:\+?212|0)?[67]\d{8}$/.test(value.replace(/[\s.-]/g, ""));
}

function isPureNumber(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function includesTerm(value: string, terms: string[]): boolean {
  const normalized = normalizeText(value);

  return terms.some((term) => normalized.includes(normalizeText(term)));
}

export function isActionPhrase(text: string): boolean {
  const normalized = normalizeText(text);

  if (!normalized) {
    return false;
  }

  return actionPhrases.some((phrase) => {
    const normalizedPhrase = normalizeText(phrase);

    if (normalizedPhrase.length <= 2) {
      return normalized === normalizedPhrase;
    }

    return (
      normalized === normalizedPhrase ||
      normalized.includes(normalizedPhrase)
    );
  });
}

export function isValidPhone(value: string): boolean {
  return Boolean(value.trim()) && !isActionPhrase(value) && isPhoneLike(value);
}

export function normalizeMoroccanPhone(value: string): string {
  const compact = value.replace(/[\s.-]/g, "").trim();

  if (/^\+212[67]\d{8}$/.test(compact)) {
    return `0${compact.slice(4)}`;
  }

  if (/^212[67]\d{8}$/.test(compact)) {
    return `0${compact.slice(3)}`;
  }

  return compact;
}

export function isValidFullName(value: string): boolean {
  const trimmed = value.trim();
  const normalized = normalizeText(trimmed);

  if (trimmed.length < 3 || normalized.split(/\s+/).length > 5) {
    return false;
  }

  if (isActionPhrase(trimmed) || isPhoneLike(trimmed) || isPureNumber(trimmed)) {
    return false;
  }

  if (includesTerm(trimmed, productOnlyWords)) {
    return false;
  }

  return /^[\p{Script=Arabic}a-zA-ZÀ-ÿ\s'-]+$/u.test(trimmed);
}

export function isValidAddress(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length < 4 || isActionPhrase(trimmed)) {
    return false;
  }

  if (/^(نعم|لا|yes|no|ok)$/i.test(normalizeText(trimmed))) {
    return false;
  }

  if (isPhoneLike(trimmed)) {
    return false;
  }

  return /[\p{Script=Arabic}a-zA-ZÀ-ÿ]/u.test(trimmed);
}

export function isValidCity(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length < 2 || isActionPhrase(trimmed)) {
    return false;
  }

  if (isPhoneLike(trimmed) || isPureNumber(trimmed)) {
    return false;
  }

  return /^[\p{Script=Arabic}a-zA-ZÀ-ÿ\s'-]+$/u.test(trimmed);
}

export function isValidSize(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed || isActionPhrase(trimmed)) {
    return false;
  }

  return /^(3[6-9]|4[0-5]|xs|s|m|l|xl|xxl)$/i.test(trimmed);
}

export function isValidColor(
  value: string,
  productContext?: ProductContext,
): boolean {
  const trimmed = value.trim();

  if (!trimmed || isActionPhrase(trimmed)) {
    return false;
  }

  const configuredColors =
    productContext?.availableColors?.map((color) => color.trim()).filter(Boolean) ||
    [];
  const allowedColors = [...configuredColors, ...colorAliases];
  const comparable = normalizeComparable(trimmed);

  return allowedColors.some(
    (color) => normalizeComparable(color) === comparable,
  );
}

export function isValidQuantity(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10;
}

export function isValidOrderField(
  field: keyof OrderEntities,
  value: OrderEntities[keyof OrderEntities],
  productContext?: ProductContext,
): boolean {
  if (field === "quantity") {
    return isValidQuantity(value as number | undefined);
  }

  if (typeof value !== "string") {
    return false;
  }

  switch (field) {
    case "fullName":
      return isValidFullName(value);
    case "phone":
      return isValidPhone(value);
    case "city":
      return isValidCity(value);
    case "address":
      return isValidAddress(value);
    case "size":
      return isValidSize(value);
    case "color":
      return isValidColor(value, productContext);
    default:
      return Boolean(value.trim()) && !isActionPhrase(value);
  }
}

export function validateOrderEntities(
  entities: Partial<OrderEntities>,
  productContext?: ProductContext,
): {
  validEntities: Partial<OrderEntities>;
  invalidFields: string[];
} {
  const validEntities: Partial<OrderEntities> = {};
  const invalidFields: string[] = [];

  for (const [field, value] of Object.entries(entities) as Array<[
    keyof OrderEntities,
    OrderEntities[keyof OrderEntities],
  ]>) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (field === "phone" && typeof value === "string") {
      const normalizedPhone = normalizeMoroccanPhone(value);

      if (isValidOrderField(field, normalizedPhone, productContext)) {
        validEntities.phone = normalizedPhone;
      } else {
        invalidFields.push(field);
      }

      continue;
    }

    if (isValidOrderField(field, value, productContext)) {
      (validEntities[field] as typeof value) = value;
    } else {
      invalidFields.push(field);
    }
  }

  return {
    validEntities,
    invalidFields,
  };
}

export function getInvalidOrderFields(
  entities: Partial<OrderEntities>,
  requiredFields: string[],
  productContext?: ProductContext,
): string[] {
  return requiredFields.filter((field) => {
    const key = field as keyof OrderEntities;
    const value = entities[key];

    return !isValidOrderField(key, value, productContext);
  });
}

export function getOrderFieldValidationDiagnostics(): OrderFieldValidationDiagnostics {
  return { ...diagnostics };
}

export function recordInvalidCandidateRejected(input: {
  field: keyof OrderEntities;
  value: OrderEntities[keyof OrderEntities];
  reason?: string;
}) {
  diagnostics.totalOrderFieldInvalidCandidatesRejected += 1;
  logJson({
    event: "order_field.invalid_candidate_rejected",
    field: input.field,
    valuePreview: previewValue(input.value, input.field),
    reason: input.reason || "invalid_order_field",
  });
}

export function recordInvalidExistingCleared(input: {
  field: keyof OrderEntities;
  value: OrderEntities[keyof OrderEntities];
}) {
  diagnostics.totalOrderFieldInvalidExistingCleared += 1;
  logJson({
    event: "order_field.invalid_existing_cleared",
    field: input.field,
    valuePreview: previewValue(input.value, input.field),
  });
}

export function recordOrderConfirmationBlockedInvalidFields(input: {
  invalidFields: string[];
}) {
  diagnostics.totalOrderConfirmationBlockedInvalidFields += 1;
  logJson({
    event: "order_confirmation.blocked_invalid_fields",
    invalidFields: input.invalidFields,
  });
}

export function recordReceiptSkippedInvalidOrderFields(input: {
  orderId: string;
  invalidFields: string[];
}) {
  diagnostics.totalReceiptSkippedInvalidOrderFields += 1;
  logJson({
    event: "order_receipt.skipped_invalid_order_fields",
    orderId: input.orderId,
    invalidFields: input.invalidFields,
  });
}
