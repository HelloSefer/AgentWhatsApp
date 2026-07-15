import type { RequiredOrderField } from "../config/required-fields.types";
import type { ContextualOrderUnderstandingInput, OrderUnderstandingContext } from "./order-understanding.types";
import { classifyOrderMessageDisposition } from "./message-disposition.service";

function hasValue(value: unknown): boolean {
  return typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string"
      ? Boolean(value.trim())
      : false;
}

export function isFieldEffectivelyRequired(
  field: RequiredOrderField,
  collected: Record<string, unknown>,
): boolean {
  const requirement = field.requirement || (field.required ? "REQUIRED" : "OPTIONAL");

  if (!field.enabled || requirement === "DISABLED" || requirement === "OPTIONAL") {
    return false;
  }

  if (requirement !== "CONDITIONAL") {
    return true;
  }

  const condition = field.condition;

  if (!condition) {
    return false;
  }

  const actual = collected[condition.fieldKey];

  if (typeof condition.exists === "boolean") {
    return condition.exists ? hasValue(actual) : !hasValue(actual);
  }

  return condition.equals !== undefined && actual === condition.equals;
}

export function buildOrderUnderstandingContext(
  input: ContextualOrderUnderstandingInput,
): OrderUnderstandingContext {
  const disposition = classifyOrderMessageDisposition(input.message);
  const fields = (input.fields || []).filter((field) => field.enabled || field.requirement === "DISABLED");
  const collected = input.session.orderState.collected as Record<string, unknown>;
  const effectiveRequiredFields = fields.filter((field) => isFieldEffectivelyRequired(field, collected));
  const missingFields = effectiveRequiredFields
    .filter((field) => !hasValue(collected[field.key]))
    .map((field) => field.key);
  const activeOptionalFieldKey = input.session.orderState.optionalFieldDialogue
    ?.activeOptionalFieldKey;
  const awaitedField = fields.find(
    (field) =>
      field.key === missingFields[0] ||
      (!missingFields.length && field.key === activeOptionalFieldKey),
  );

  return {
    sellerId: input.session.sellerId,
    conversationKey: input.session.conversationKey,
    orderCycleId: input.session.orderState.orderCycleId,
    customerId: input.customerId,
    customerMessage: input.message.trim(),
    extractionMessage: disposition.extractionText,
    disposition: disposition.disposition,
    messageConsumed: disposition.consumed,
    residualExtractionUsed: disposition.residualExtractionUsed,
    residualDisposition: disposition.residualDisposition,
    residualFieldHint: disposition.residualFieldHint,
    productContext: input.productContext,
    session: input.session,
    fields,
    effectiveRequiredFields,
    optionalFields: fields.filter((field) => !isFieldEffectivelyRequired(field, collected) && field.enabled),
    missingFields,
    awaitedField,
    recentMessages: input.session.messages.slice(-6),
  };
}
