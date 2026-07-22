import type { CatalogOption } from "./catalog-option";
import type { Money } from "./money";

export type ProductAvailability = "available" | "unavailable";

export type CatalogProduct = Readonly<{
  sellerId: string;
  productId: string;
  name: string;
  description?: string;
  price: Money;
  availability: ProductAvailability;
  options: readonly CatalogOption[];
  createdAt: Date;
  updatedAt: Date;
}>;

export type CatalogProductInput = Readonly<{
  productId: unknown;
  name: unknown;
  description?: unknown;
  price: unknown;
  availability: unknown;
  options?: unknown;
}>;

export type CatalogProductDraft = Omit<CatalogProduct, "sellerId" | "createdAt" | "updatedAt">;
