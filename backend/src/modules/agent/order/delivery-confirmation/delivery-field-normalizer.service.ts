import { getEffectiveCaptureMode, validateCandidateForField } from "../../order-understanding/contextual-field-validator.service";
import type { ProductContext } from "../../config/product-context.types";
import type { ProductContext as LegacyProductContext } from "../../product-context.types";
import type { SupportedOrderFieldValue } from "../cart-state.types";
import type { DeliveryFieldValueNormalizationResult, DeliveryRequirement } from "./delivery-confirmation.types";

const MAX_DELIVERY_FIELD_TEXT_LENGTH = 180;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/u;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Deterministic field normalizer. It deliberately has no intent or AI dependency. */
export function normalizeDeliveryFieldValue(input: {
  requirement: DeliveryRequirement;
  rawValue: unknown;
  productContext: ProductContext;
}): DeliveryFieldValueNormalizationResult {
  if (typeof input.rawValue !== "string" && typeof input.rawValue !== "number") {
    return { valid: false, failureCode: "FIELD_VALUE_NOT_TEXT" };
  }

  const captureMode = getEffectiveCaptureMode(input.requirement.field);
  const rawText = typeof input.rawValue === "string" ? input.rawValue : String(input.rawValue);
  if (CONTROL_CHARACTERS.test(rawText)) {
    return { valid: false, failureCode: "FIELD_VALUE_HAS_CONTROL_CHARACTERS" };
  }
  if (Array.from(rawText).length > MAX_DELIVERY_FIELD_TEXT_LENGTH) {
    return { valid: false, failureCode: "FIELD_VALUE_TOO_LONG" };
  }

  const candidateValue = captureMode === "NUMERIC"
    ? input.rawValue
    : compactWhitespace(rawText);
  const validated = validateCandidateForField(
    {
      fieldKey: input.requirement.key,
      value: candidateValue,
      operation: "SET",
      confidence: 1,
      source: "deterministic_exact",
    },
    input.requirement.field,
    input.productContext as unknown as LegacyProductContext,
  );

  if (!validated.candidate) {
    return {
      valid: false,
      failureCode: input.requirement.options?.length
        ? "FIELD_VALUE_NOT_CONFIGURED"
        : "INVALID_FIELD_VALUE",
    };
  }

  const value = validated.candidate.value;
  if (typeof value === "string" && !value.trim()) {
    return { valid: false, failureCode: "INVALID_FIELD_VALUE" };
  }

  return { valid: true, value: value as SupportedOrderFieldValue };
}
