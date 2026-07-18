import { resolveCartFieldScope } from "../cart-state.service";
import type { SupportedOrderFieldValue } from "../cart-state.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import type { ValidatedItemOption } from "./item-collection.types";

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function isRequired(field: RequiredOrderField): boolean {
  const requirement = field.requirement || (field.required ? "REQUIRED" : "OPTIONAL");
  return field.enabled && requirement !== "DISABLED" && requirement !== "OPTIONAL";
}

function isQuantityField(field: RequiredOrderField): boolean {
  return (
    normalizeKey(field.key) === "quantity" ||
    field.semanticType?.trim().toUpperCase() === "QUANTITY"
  );
}

function isSupportedValue(value: unknown): value is SupportedOrderFieldValue {
  if (typeof value === "string") {
    return Boolean(value.trim());
  }

  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function sortFields(fields: RequiredOrderField[]): RequiredOrderField[] {
  return [...fields].sort((left, right) =>
    left.askOrder === right.askOrder
      ? left.key.localeCompare(right.key)
      : left.askOrder - right.askOrder,
  );
}

/** Returns every configured, enabled item option except the separate quantity field. */
export function getItemCollectionOptionFields(
  fields: RequiredOrderField[],
): RequiredOrderField[] {
  return sortFields(
    fields.filter(
      (field) =>
        field.enabled &&
        resolveCartFieldScope(field) === "ITEM" &&
        !isQuantityField(field) &&
        (field.requirement || (field.required ? "REQUIRED" : "OPTIONAL")) !== "DISABLED",
    ),
  );
}

/** Returns the ordered, required subset of configured item options. */
export function getRequiredItemCollectionFields(
  fields: RequiredOrderField[],
): RequiredOrderField[] {
  return getItemCollectionOptionFields(fields).filter(isRequired);
}

function findFieldByKey(
  fields: RequiredOrderField[],
  optionKey: string,
): RequiredOrderField | undefined {
  const normalized = normalizeKey(optionKey);
  return fields.find((field) => normalizeKey(field.key) === normalized);
}

export function validateItemCollectionOption(input: {
  fields: RequiredOrderField[];
  optionKey: string;
  value: unknown;
}):
  | { valid: true; option: ValidatedItemOption }
  | { valid: false; failureCode: "INVALID_ITEM_OPTION" | "ORDER_SCOPED_FIELD" | "INVALID_ITEM_OPTION_VALUE" } {
  const field = findFieldByKey(input.fields, input.optionKey);
  if (!field) {
    return { valid: false, failureCode: "INVALID_ITEM_OPTION" };
  }

  if (resolveCartFieldScope(field) !== "ITEM" || isQuantityField(field)) {
    return { valid: false, failureCode: "ORDER_SCOPED_FIELD" };
  }

  if (!field.enabled || (field.requirement || (field.required ? "REQUIRED" : "OPTIONAL")) === "DISABLED") {
    return { valid: false, failureCode: "INVALID_ITEM_OPTION" };
  }

  if (!isSupportedValue(input.value)) {
    return { valid: false, failureCode: "INVALID_ITEM_OPTION_VALUE" };
  }

  if (!field.options?.length) {
    return { valid: true, option: { field, value: input.value } };
  }

  if (typeof input.value !== "string") {
    return { valid: false, failureCode: "INVALID_ITEM_OPTION_VALUE" };
  }

  const normalizedValue = input.value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const configuredValue = field.options.find(
    (option) => option.trim().toLocaleLowerCase().replace(/\s+/g, " ") === normalizedValue,
  );

  return configuredValue
    ? { valid: true, option: { field, value: configuredValue } }
    : { valid: false, failureCode: "INVALID_ITEM_OPTION_VALUE" };
}
