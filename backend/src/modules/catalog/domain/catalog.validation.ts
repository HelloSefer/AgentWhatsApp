import type { CatalogOption, CatalogOptionValue } from "./catalog-option";
import type { CatalogProductDraft, CatalogProductInput, ProductAvailability } from "./catalog-product";
import { CatalogValidationError } from "./catalog.errors";
import { validateMoney } from "./money";

export const CATALOG_ID_MAX_LENGTH = 128;
export const CATALOG_LABEL_MAX_LENGTH = 255;
export const CATALOG_DESCRIPTION_MAX_LENGTH = 4_000;

function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw new CatalogValidationError();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) throw new CatalogValidationError();
  return trimmed;
}

function optionalDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new CatalogValidationError();
  const trimmed = value.trim();
  if (trimmed.length > CATALOG_DESCRIPTION_MAX_LENGTH) throw new CatalogValidationError();
  return trimmed || undefined;
}

function position(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new CatalogValidationError();
  return value as number;
}

function validateOptionValue(value: unknown): CatalogOptionValue {
  if (typeof value !== "object" || value === null) throw new CatalogValidationError();
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.isAvailable !== "boolean") throw new CatalogValidationError();
  return {
    valueId: requiredString(candidate.valueId, CATALOG_ID_MAX_LENGTH),
    label: requiredString(candidate.label, CATALOG_LABEL_MAX_LENGTH),
    position: position(candidate.position),
    isAvailable: candidate.isAvailable,
  };
}

function validateOption(value: unknown): CatalogOption {
  if (typeof value !== "object" || value === null) throw new CatalogValidationError();
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.required !== "boolean" || !Array.isArray(candidate.values)) throw new CatalogValidationError();
  const values = candidate.values.map(validateOptionValue).sort((left, right) => left.position - right.position);
  const valueIds = new Set<string>();
  const positions = new Set<number>();
  for (const entry of values) {
    if (valueIds.has(entry.valueId) || positions.has(entry.position)) throw new CatalogValidationError();
    valueIds.add(entry.valueId);
    positions.add(entry.position);
  }
  return {
    optionId: requiredString(candidate.optionId, CATALOG_ID_MAX_LENGTH),
    label: requiredString(candidate.label, CATALOG_LABEL_MAX_LENGTH),
    required: candidate.required,
    position: position(candidate.position),
    values,
  };
}

export function validateCatalogProductInput(input: CatalogProductInput): CatalogProductDraft {
  if (typeof input !== "object" || input === null) throw new CatalogValidationError();
  const optionsRaw = input.options === undefined ? [] : input.options;
  if (!Array.isArray(optionsRaw)) throw new CatalogValidationError();
  const options = optionsRaw.map(validateOption).sort((left, right) => left.position - right.position);
  const optionIds = new Set<string>();
  const positions = new Set<number>();
  for (const option of options) {
    if (optionIds.has(option.optionId) || positions.has(option.position)) throw new CatalogValidationError();
    optionIds.add(option.optionId);
    positions.add(option.position);
  }
  if (input.availability !== "available" && input.availability !== "unavailable") throw new CatalogValidationError();
  return {
    productId: requiredString(input.productId, CATALOG_ID_MAX_LENGTH),
    name: requiredString(input.name, CATALOG_LABEL_MAX_LENGTH),
    description: optionalDescription(input.description),
    price: validateMoney(input.price),
    availability: input.availability as ProductAvailability,
    options,
  };
}

export function validateProductAvailability(value: unknown): ProductAvailability {
  if (value !== "available" && value !== "unavailable") throw new CatalogValidationError();
  return value;
}

export function validateCatalogListLimit(value: unknown): number {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) throw new CatalogValidationError();
  return value as number;
}

export function validateCatalogCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, CATALOG_ID_MAX_LENGTH);
}

export function validateCatalogProductId(value: unknown): string {
  return requiredString(value, CATALOG_ID_MAX_LENGTH);
}
