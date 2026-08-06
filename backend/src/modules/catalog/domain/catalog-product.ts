import type { CatalogOption } from "./catalog-option";
import type { Money } from "./money";

export type ProductAvailability = "available" | "unavailable";

export const CATALOG_PRODUCT_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type CatalogProductImageMimeType = (typeof CATALOG_PRODUCT_IMAGE_MIME_TYPES)[number];

export type CatalogProductImage = Readonly<{
  objectKey: string;
  mimeType: CatalogProductImageMimeType;
  position: number;
}>;

export type CatalogProductAlias = Readonly<{
  alias: string;
  normalizedAlias: string;
}>;

export type CatalogProductOffer = Readonly<{
  offerId: string;
  label: string;
  requiredItemCount: number;
  totalPriceAmountMinor: number;
  currencyCode: string;
  active: boolean;
  allowMixedOptions: boolean;
  priority?: number;
  startsAt?: string;
  endsAt?: string;
}>;

export type CatalogProduct = Readonly<{
  sellerId: string;
  productId: string;
  name: string;
  description?: string;
  price: Money;
  availability: ProductAvailability;
  options: readonly CatalogOption[];
  images: readonly CatalogProductImage[];
  aliases: readonly CatalogProductAlias[];
  offers: readonly CatalogProductOffer[];
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
  images?: unknown;
  aliases?: unknown;
  offers?: unknown;
}>;

export type CatalogProductDraft = Omit<CatalogProduct, "sellerId" | "createdAt" | "updatedAt">;
