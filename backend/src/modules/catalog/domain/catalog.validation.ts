import type { CatalogOption, CatalogOptionValue } from "./catalog-option";
import {
  CATALOG_PRODUCT_IMAGE_MIME_TYPES,
  type CatalogProductAlias,
  type CatalogProductDraft,
  type CatalogProductImage,
  type CatalogProductImageMimeType,
  type CatalogProductInput,
  type CatalogProductOffer,
  type ProductAvailability,
} from "./catalog-product";
import { CatalogValidationError } from "./catalog.errors";
import { validateMoney } from "./money";

export const CATALOG_ID_MAX_LENGTH = 128;
export const CATALOG_LABEL_MAX_LENGTH = 255;
export const CATALOG_DESCRIPTION_MAX_LENGTH = 4_000;
export const CATALOG_IMAGE_OBJECT_KEY_MAX_LENGTH = 512;
export const CATALOG_OFFER_LABEL_MAX_LENGTH = 160;
export const CATALOG_OFFER_PRIORITY_MAX_ABS = 100_000;

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

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function normalizeAlias(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/[ًٌٍَُِّْـ]/gu, "")
    .replace(/[؟?،,.;:!]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function imageMimeType(value: unknown): CatalogProductImageMimeType {
  if (!CATALOG_PRODUCT_IMAGE_MIME_TYPES.includes(value as CatalogProductImageMimeType)) throw new CatalogValidationError();
  return value as CatalogProductImageMimeType;
}

function imageObjectKey(value: unknown, sellerId: string | undefined, mimeType: CatalogProductImageMimeType): string {
  if (typeof value !== "string") throw new CatalogValidationError();
  const objectKey = value.trim();
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
  const prefix = sellerId ? `product-images/${sellerId}/` : "product-images/";
  if (
    !sellerId ||
    !objectKey ||
    objectKey.length > CATALOG_IMAGE_OBJECT_KEY_MAX_LENGTH ||
    objectKey !== value ||
    objectKey.startsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.includes("://") ||
    objectKey.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[a-f0-9]{32}\\.${extension}$`, "u").test(objectKey)
  ) throw new CatalogValidationError();
  return objectKey;
}

function validateImage(value: unknown, sellerId: string | undefined): CatalogProductImage {
  if (typeof value !== "object" || value === null) throw new CatalogValidationError();
  const candidate = value as Record<string, unknown>;
  const mimeType = imageMimeType(candidate.mimeType);
  return {
    objectKey: imageObjectKey(candidate.objectKey, sellerId, mimeType),
    mimeType,
    position: position(candidate.position),
  };
}

function validateImages(value: unknown, sellerId: string | undefined): readonly CatalogProductImage[] {
  if (!Array.isArray(value)) throw new CatalogValidationError();
  const images = value.map((entry) => validateImage(entry, sellerId)).sort((left, right) => left.position - right.position);
  const positions = new Set<number>();
  const objectKeys = new Set<string>();
  for (const image of images) {
    if (positions.has(image.position) || objectKeys.has(image.objectKey)) throw new CatalogValidationError();
    positions.add(image.position);
    objectKeys.add(image.objectKey);
  }
  return images;
}

function validateAliases(value: unknown): readonly CatalogProductAlias[] {
  if (!Array.isArray(value)) throw new CatalogValidationError();
  const aliases: CatalogProductAlias[] = [];
  const normalized = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") throw new CatalogValidationError();
    const alias = candidate.trim();
    if (!alias || alias.length > CATALOG_LABEL_MAX_LENGTH || hasControlCharacters(alias)) throw new CatalogValidationError();
    const normalizedAlias = normalizeAlias(alias);
    if (!normalizedAlias || normalizedAlias.length > CATALOG_LABEL_MAX_LENGTH || normalized.has(normalizedAlias)) throw new CatalogValidationError();
    normalized.add(normalizedAlias);
    aliases.push({ alias, normalizedAlias });
  }
  return aliases.sort((left, right) => left.normalizedAlias.localeCompare(right.normalizedAlias));
}

function timestamp(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new CatalogValidationError();
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) throw new CatalogValidationError();
  return date.toISOString();
}

function validateOffers(value: unknown, currencyCode: string): readonly CatalogProductOffer[] {
  if (!Array.isArray(value)) throw new CatalogValidationError();
  const offers: CatalogProductOffer[] = [];
  const ids = new Set<string>();
  for (const candidateInput of value) {
    if (typeof candidateInput !== "object" || candidateInput === null) throw new CatalogValidationError();
    const candidate = candidateInput as Record<string, unknown>;
    const offerId = requiredString(candidate.offerId, CATALOG_ID_MAX_LENGTH);
    const label = requiredString(candidate.label, CATALOG_OFFER_LABEL_MAX_LENGTH);
    const startsAt = timestamp(candidate.startsAt);
    const endsAt = timestamp(candidate.endsAt);
    if (
      ids.has(offerId) ||
      !Number.isSafeInteger(candidate.requiredItemCount) || (candidate.requiredItemCount as number) <= 0 ||
      !Number.isSafeInteger(candidate.totalPriceAmountMinor) || (candidate.totalPriceAmountMinor as number) <= 0 ||
      typeof candidate.active !== "boolean" ||
      typeof candidate.allowMixedOptions !== "boolean" ||
      (candidate.priority !== undefined && (!Number.isSafeInteger(candidate.priority) || Math.abs(candidate.priority as number) > CATALOG_OFFER_PRIORITY_MAX_ABS)) ||
      (startsAt && endsAt && startsAt >= endsAt)
    ) throw new CatalogValidationError();
    ids.add(offerId);
    offers.push({
      offerId,
      label,
      requiredItemCount: candidate.requiredItemCount as number,
      totalPriceAmountMinor: candidate.totalPriceAmountMinor as number,
      currencyCode,
      active: candidate.active,
      allowMixedOptions: candidate.allowMixedOptions,
      ...(candidate.priority === undefined ? {} : { priority: candidate.priority as number }),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
    });
  }
  return offers.sort((left, right) => (left.priority || 0) - (right.priority || 0) || left.requiredItemCount - right.requiredItemCount || left.offerId.localeCompare(right.offerId));
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

export function validateCatalogProductInput(input: CatalogProductInput, sellerId?: string): CatalogProductDraft {
  if (typeof input !== "object" || input === null) throw new CatalogValidationError();
  const optionsRaw = input.options === undefined ? [] : input.options;
  const imagesRaw = input.images === undefined ? [] : input.images;
  const aliasesRaw = input.aliases === undefined ? [] : input.aliases;
  const offersRaw = input.offers === undefined ? [] : input.offers;
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
  const price = validateMoney(input.price);
  return {
    productId: requiredString(input.productId, CATALOG_ID_MAX_LENGTH),
    name: requiredString(input.name, CATALOG_LABEL_MAX_LENGTH),
    description: optionalDescription(input.description),
    price,
    availability: input.availability as ProductAvailability,
    options,
    images: validateImages(imagesRaw, sellerId),
    aliases: validateAliases(aliasesRaw),
    offers: validateOffers(offersRaw, price.currencyCode),
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
