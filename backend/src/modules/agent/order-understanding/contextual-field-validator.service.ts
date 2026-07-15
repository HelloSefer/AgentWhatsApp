import type { RequiredOrderField } from "../config/required-fields.types";
import type { OrderFieldCaptureMode } from "../config/seller-config.types";
import {
  isActionPhrase,
  isValidAddress,
  isValidCity,
  isValidFullName,
  isValidPhone,
  normalizeMoroccanPhone,
} from "../order/order-field-validator.service";
import type { FieldCandidate, OrderUnderstandingContext } from "./order-understanding.types";

export function normalizeUnderstandingText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesConfiguredOption(value: string, field: RequiredOrderField): string | undefined {
  const comparable = normalizeUnderstandingText(value).replace(/^ال/, "");

  return field.options?.find((option) => {
    const normalizedOption = normalizeUnderstandingText(option).replace(/^ال/, "");
    const aliases = field.aliases || [];

    return normalizedOption === comparable || aliases.some((alias) =>
      normalizeUnderstandingText(alias).replace(/^ال/, "") === comparable,
    );
  });
}

function isOpenLocation(value: string): boolean {
  const clean = value.trim();

  return (
    clean.length >= 2 &&
    clean.length <= 90 &&
    !isActionPhrase(clean) &&
    !isValidPhone(clean) &&
    !/^\d+$/.test(clean) &&
    !/[؟?]/.test(clean) &&
    isValidCity(clean)
  );
}

function isValidNumeric(value: unknown, field: RequiredOrderField): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    (field.minValue === undefined || value >= field.minValue) &&
    (field.maxValue === undefined || value <= field.maxValue)
  );
}

export function getEffectiveCaptureMode(
  field: RequiredOrderField,
): OrderFieldCaptureMode {
  if (field.captureMode) {
    return field.captureMode;
  }

  if (field.options?.length) {
    return "CONFIGURED_ENUM";
  }

  const semanticType = normalizeUnderstandingText(field.semanticType || "")
    .replace(/[\s-]+/g, "_");

  if (["phone", "phone_number", "telephone"].includes(semanticType)) {
    return "PHONE";
  }
  if (["location", "locality", "city", "village", "commune", "neighborhood"].includes(semanticType)) {
    return "LOCATION";
  }
  if (["address", "delivery_address"].includes(semanticType)) {
    return "ADDRESS";
  }
  if (["quantity", "numeric", "number"].includes(semanticType)) {
    return "NUMERIC";
  }

  if (field.key === "phone") return "PHONE";
  if (field.key === "quantity") return "NUMERIC";
  if (field.key === "city") return "LOCATION";
  if (field.key === "address") return "ADDRESS";
  return "OPEN_TEXT";
}

function isPersonNameField(field: RequiredOrderField): boolean {
  const semanticType = normalizeUnderstandingText(field.semanticType || "")
    .replace(/[\s-]+/g, "_");

  return field.key === "fullName" || ["person_name", "full_name", "customer_name", "name"].includes(semanticType);
}

export function validateContextualCandidate(
  candidate: FieldCandidate,
  context: OrderUnderstandingContext,
): { candidate?: FieldCandidate; reason?: string } {
  const field = context.fields.find((entry) => entry.key === candidate.fieldKey);

  return validateCandidateForField(candidate, field, context.productContext);
}

export function validateCandidateForField(
  candidate: FieldCandidate,
  field: RequiredOrderField | undefined,
  productContext: OrderUnderstandingContext["productContext"],
): { candidate?: FieldCandidate; reason?: string } {

  if (!field || !field.enabled || field.requirement === "DISABLED") {
    return { reason: "unknown_or_disabled_field" };
  }

  if (typeof candidate.value === "string" && !candidate.value.trim()) {
    return { reason: "empty_value" };
  }

  const captureMode = getEffectiveCaptureMode(field);
  let value = candidate.value;

  if (captureMode === "CONFIGURED_ENUM") {
    if (typeof value !== "string") {
      return { reason: "configured_option_not_text" };
    }

    const option = matchesConfiguredOption(value, field);
    return option ? { candidate: { ...candidate, value: option } } : { reason: "unavailable_configured_option" };
  }

  if (captureMode === "PHONE") {
    if (typeof value !== "string") {
      return { reason: "invalid_phone" };
    }

    value = normalizeMoroccanPhone(value);
    return isValidPhone(value) ? { candidate: { ...candidate, value } } : { reason: "invalid_phone" };
  }

  if (captureMode === "NUMERIC") {
    const numberValue = typeof value === "number" ? value : Number(value);
    return isValidNumeric(numberValue, field)
      ? { candidate: { ...candidate, value: numberValue } }
      : { reason: "invalid_numeric_value" };
  }

  if (typeof value !== "string") {
    return { reason: "invalid_text_value" };
  }

  if (captureMode === "LOCATION") {
    return isOpenLocation(value) ? { candidate: { ...candidate, value: value.trim() } } : { reason: "invalid_location" };
  }

  if (captureMode === "ADDRESS") {
    return isValidAddress(value) ? { candidate: { ...candidate, value: value.trim() } } : { reason: "invalid_address" };
  }

  if (isPersonNameField(field) && !isValidFullName(value)) {
    return { reason: "invalid_name" };
  }

  return !isActionPhrase(value)
    ? { candidate: { ...candidate, value: value.trim() } }
    : { reason: "action_not_value" };
}
