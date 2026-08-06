import type { CatalogProduct } from "../domain/catalog-product";

export type CatalogProductResponse = Readonly<{
  productId: string;
  name: string;
  description: string | null;
  price: Readonly<{ amountMinor: number; currencyCode: string }>;
  availability: "available" | "unavailable";
  options: readonly Readonly<{ optionId: string; label: string; required: boolean; position: number; values: readonly Readonly<{ valueId: string; label: string; position: number; isAvailable: boolean }>[] }> [];
  images: readonly Readonly<{ objectKey: string; mimeType: string; position: number }>[];
  aliases: readonly string[];
  offers: readonly Readonly<{ offerId: string; label: string; requiredItemCount: number; totalPriceAmountMinor: number; active: boolean; allowMixedOptions: boolean; priority?: number; startsAt?: string; endsAt?: string }>[];
  createdAt: string;
  updatedAt: string;
}>;

export function toCatalogProductResponse(product: CatalogProduct): CatalogProductResponse {
  return {
    productId: product.productId,
    name: product.name,
    description: product.description ?? null,
    price: product.price,
    availability: product.availability,
    options: product.options.map((option) => ({ ...option, values: option.values.map((value) => ({ ...value })) })),
    images: product.images.map((image) => ({ ...image })),
    aliases: product.aliases.map((alias) => alias.alias),
    offers: product.offers.map(({ currencyCode: _currencyCode, ...offer }) => ({ ...offer })),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
