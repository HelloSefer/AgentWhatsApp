import type { RequiredOrderField } from "../../config/required-fields.types";
import { resolveCartFieldScope } from "../cart-state.service";
import type { CartDraft, SupportedOrderFieldValue } from "../cart-state.types";
import type { DeliveryRequirement } from "./delivery-confirmation.types";

function hasValue(value: unknown): value is SupportedOrderFieldValue {
  return typeof value === "string"
    ? Boolean(value.trim())
    : typeof value === "number"
      ? Number.isFinite(value)
      : typeof value === "boolean";
}

function normalizedKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function isConditionMet(field: RequiredOrderField, cart: CartDraft): boolean {
  if (!field.condition) return field.requirement !== "CONDITIONAL";

  const value = cart.orderLevelFields[field.condition.fieldKey];
  if (typeof field.condition.exists === "boolean") {
    return field.condition.exists ? hasValue(value) : !hasValue(value);
  }

  return field.condition.equals !== undefined && value === field.condition.equals;
}

function isRequired(field: RequiredOrderField): boolean {
  const requirement = field.requirement || (field.required ? "REQUIRED" : "OPTIONAL");
  return requirement === "REQUIRED" || requirement === "CONDITIONAL";
}

function isExplicitOptional(field: RequiredOrderField, included: ReadonlySet<string>): boolean {
  const requirement = field.requirement || (field.required ? "REQUIRED" : "OPTIONAL");
  return requirement === "OPTIONAL" && included.has(normalizedKey(field.key));
}

function toRequirement(field: RequiredOrderField): DeliveryRequirement {
  return {
    key: field.key,
    label: field.label || field.key,
    ...(field.prompt ? { prompt: field.prompt } : {}),
    required: isRequired(field),
    ...(field.captureMode ? { captureMode: field.captureMode } : {}),
    ...(field.semanticType ? { semanticType: field.semanticType } : {}),
    ...(field.options?.length ? { options: [...field.options] } : {}),
    field: { ...field, ...(field.options ? { options: [...field.options] } : {}) },
  };
}

/** Resolves only configured shared fields. Item options never cross this boundary. */
export function getDeliveryRequirements(input: {
  fields: RequiredOrderField[];
  cart: CartDraft;
  includeOptionalFieldKeys?: readonly string[];
}): DeliveryRequirement[] {
  const included = new Set((input.includeOptionalFieldKeys || []).map(normalizedKey));

  return input.fields
    .filter((field) => {
      const requirement = field.requirement || (field.required ? "REQUIRED" : "OPTIONAL");
      return field.enabled && requirement !== "DISABLED" && resolveCartFieldScope(field) === "ORDER";
    })
    .filter((field) => isConditionMet(field, input.cart))
    .filter((field) => isRequired(field) || isExplicitOptional(field, included))
    .sort((left, right) => left.askOrder === right.askOrder
      ? left.key.localeCompare(right.key)
      : left.askOrder - right.askOrder)
    .map(toRequirement);
}

export function findDeliveryRequirement(
  requirements: readonly DeliveryRequirement[],
  fieldKey: string,
): DeliveryRequirement | undefined {
  const key = normalizedKey(fieldKey);
  return requirements.find((field) => normalizedKey(field.key) === key);
}

export function getMissingDeliveryRequirement(
  requirements: readonly DeliveryRequirement[],
  cart: CartDraft,
): DeliveryRequirement | undefined {
  return requirements.find((field) => !hasValue(cart.orderLevelFields[field.key]));
}

export function getCollectedDeliveryFields(
  requirements: readonly DeliveryRequirement[],
  cart: CartDraft,
): Array<{ requirement: DeliveryRequirement; value: SupportedOrderFieldValue }> {
  return requirements.flatMap((requirement) => {
    const value = cart.orderLevelFields[requirement.key];
    return hasValue(value) ? [{ requirement, value }] : [];
  });
}
