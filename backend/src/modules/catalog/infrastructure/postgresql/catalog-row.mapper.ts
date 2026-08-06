import type { CatalogOption, CatalogOptionValue } from "../../domain/catalog-option";
import type { CatalogProduct, CatalogProductAlias, CatalogProductImage, CatalogProductImageMimeType, CatalogProductOffer, ProductAvailability } from "../../domain/catalog-product";
import { CatalogPersistenceError } from "../../domain/catalog.errors";

export type ProductRow = Readonly<{
  seller_id: string;
  product_id: string;
  name: string;
  description: string | null;
  price_amount_minor: string | number;
  currency_code: string;
  availability_status: string;
  created_at: Date | string;
  updated_at: Date | string;
}>;

export type ProductOptionRow = Readonly<{
  seller_id: string;
  product_id: string;
  option_id: string;
  label: string;
  is_required: boolean;
  position: number;
}>;

export type ProductOptionValueRow = Readonly<{
  seller_id: string;
  product_id: string;
  option_id: string;
  value_id: string;
  label: string;
  position: number;
  is_available: boolean;
}>;

export type ProductImageRow = Readonly<{
  seller_id: string;
  product_id: string;
  position: number;
  object_key: string;
  mime_type: string;
}>;

export type ProductAliasRow = Readonly<{
  seller_id: string;
  product_id: string;
  alias: string;
  normalized_alias: string;
}>;

export type ProductOfferRow = Readonly<{
  seller_id: string;
  product_id: string;
  offer_id: string;
  label: string;
  required_item_count: number;
  total_price_amount_minor: string | number;
  is_active: boolean;
  allow_mixed_options: boolean;
  priority: number | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
}>;

function validDate(value: Date | string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new CatalogPersistenceError();
  return date;
}

function amountMinor(value: string | number): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new CatalogPersistenceError();
  return amount;
}

function availability(value: string): ProductAvailability {
  if (value !== "available" && value !== "unavailable") throw new CatalogPersistenceError();
  return value;
}

function imageMimeType(value: string): CatalogProductImageMimeType {
  if (value !== "image/png" && value !== "image/jpeg" && value !== "image/webp") throw new CatalogPersistenceError();
  return value;
}

function productKey(row: Readonly<{ seller_id: string; product_id: string }>): string {
  return `${row.seller_id}\u0000${row.product_id}`;
}

export function mapCatalogProducts(
  productRows: readonly ProductRow[],
  optionRows: readonly ProductOptionRow[],
  valueRows: readonly ProductOptionValueRow[],
  imageRows: readonly ProductImageRow[],
  aliasRows: readonly ProductAliasRow[],
  offerRows: readonly ProductOfferRow[],
): readonly CatalogProduct[] {
  const valuesByOption = new Map<string, CatalogOptionValue[]>();
  for (const row of valueRows) {
    const key = `${row.seller_id}\u0000${row.product_id}\u0000${row.option_id}`;
    const entries = valuesByOption.get(key) || [];
    entries.push({ valueId: row.value_id, label: row.label, position: row.position, isAvailable: row.is_available });
    valuesByOption.set(key, entries);
  }

  const optionsByProduct = new Map<string, CatalogOption[]>();
  for (const row of optionRows) {
    const optionKey = `${row.seller_id}\u0000${row.product_id}\u0000${row.option_id}`;
    const key = productKey(row);
    const entries = optionsByProduct.get(key) || [];
    entries.push({
      optionId: row.option_id,
      label: row.label,
      required: row.is_required,
      position: row.position,
      values: (valuesByOption.get(optionKey) || []).sort((left, right) => left.position - right.position),
    });
    optionsByProduct.set(key, entries);
  }

  const imagesByProduct = new Map<string, CatalogProductImage[]>();
  for (const row of imageRows) {
    const entries = imagesByProduct.get(productKey(row)) || [];
    entries.push({ objectKey: row.object_key, mimeType: imageMimeType(row.mime_type), position: row.position });
    imagesByProduct.set(productKey(row), entries);
  }

  const aliasesByProduct = new Map<string, CatalogProductAlias[]>();
  for (const row of aliasRows) {
    const entries = aliasesByProduct.get(productKey(row)) || [];
    entries.push({ alias: row.alias, normalizedAlias: row.normalized_alias });
    aliasesByProduct.set(productKey(row), entries);
  }

  const offersByProduct = new Map<string, CatalogProductOffer[]>();
  for (const row of offerRows) {
    const parent = productRows.find((product) => product.seller_id === row.seller_id && product.product_id === row.product_id);
    if (!parent) throw new CatalogPersistenceError();
    const entries = offersByProduct.get(productKey(row)) || [];
    entries.push({
      offerId: row.offer_id,
      label: row.label,
      requiredItemCount: row.required_item_count,
      totalPriceAmountMinor: amountMinor(row.total_price_amount_minor),
      currencyCode: parent.currency_code,
      active: row.is_active,
      allowMixedOptions: row.allow_mixed_options,
      ...(row.priority === null ? {} : { priority: row.priority }),
      ...(row.starts_at === null ? {} : { startsAt: validDate(row.starts_at).toISOString() }),
      ...(row.ends_at === null ? {} : { endsAt: validDate(row.ends_at).toISOString() }),
    });
    offersByProduct.set(productKey(row), entries);
  }

  return productRows.map((row) => ({
    sellerId: row.seller_id,
    productId: row.product_id,
    name: row.name,
    description: row.description || undefined,
    price: { amountMinor: amountMinor(row.price_amount_minor), currencyCode: row.currency_code },
    availability: availability(row.availability_status),
    options: (optionsByProduct.get(productKey(row)) || []).sort((left, right) => left.position - right.position),
    images: (imagesByProduct.get(productKey(row)) || []).sort((left, right) => left.position - right.position),
    aliases: (aliasesByProduct.get(productKey(row)) || []).sort((left, right) => left.normalizedAlias.localeCompare(right.normalizedAlias)),
    offers: (offersByProduct.get(productKey(row)) || []).sort((left, right) => (left.priority || 0) - (right.priority || 0) || left.requiredItemCount - right.requiredItemCount || left.offerId.localeCompare(right.offerId)),
    createdAt: validDate(row.created_at),
    updatedAt: validDate(row.updated_at),
  }));
}
