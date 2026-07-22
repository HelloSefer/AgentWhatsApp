import type { CatalogOption, CatalogOptionValue } from "../../domain/catalog-option";
import type { CatalogProduct, ProductAvailability } from "../../domain/catalog-product";
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

export function mapCatalogProducts(
  productRows: readonly ProductRow[],
  optionRows: readonly ProductOptionRow[],
  valueRows: readonly ProductOptionValueRow[],
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
    const productKey = `${row.seller_id}\u0000${row.product_id}`;
    const entries = optionsByProduct.get(productKey) || [];
    entries.push({
      optionId: row.option_id,
      label: row.label,
      required: row.is_required,
      position: row.position,
      values: (valuesByOption.get(optionKey) || []).sort((left, right) => left.position - right.position),
    });
    optionsByProduct.set(productKey, entries);
  }

  return productRows.map((row) => ({
    sellerId: row.seller_id,
    productId: row.product_id,
    name: row.name,
    description: row.description || undefined,
    price: { amountMinor: amountMinor(row.price_amount_minor), currencyCode: row.currency_code },
    availability: availability(row.availability_status),
    options: (optionsByProduct.get(`${row.seller_id}\u0000${row.product_id}`) || []).sort((left, right) => left.position - right.position),
    createdAt: validDate(row.created_at),
    updatedAt: validDate(row.updated_at),
  }));
}
