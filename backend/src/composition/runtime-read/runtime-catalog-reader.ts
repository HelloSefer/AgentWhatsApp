import {
  CatalogPersistenceError,
  CatalogSellerNotFoundError,
  CatalogService,
  type CatalogProduct,
} from "../../modules/catalog";
import {
  DatabaseConfigurationError,
  DatabaseConnectionError,
  DatabaseQueryError,
  InvalidTenantContextError,
  createTenantContext,
} from "../../infrastructure/database";
import type { ProductContext, ProductOptionGroup } from "../../modules/agent/config/product-context.types";
import type { RuntimeReadFallbackReason, RuntimeReadSource } from "./runtime-read-fallback.types";
import type { RuntimeReadMode } from "./runtime-read-mode";

export type RuntimeCatalogReadResult = Readonly<{
  productContext: ProductContext;
  source: RuntimeReadSource;
  fallbackReason?: RuntimeReadFallbackReason;
}>;

function isSafeCatalogReadError(error: unknown): boolean {
  return error instanceof InvalidTenantContextError
    || error instanceof DatabaseConfigurationError
    || error instanceof DatabaseConnectionError
    || error instanceof DatabaseQueryError
    || error instanceof CatalogPersistenceError
    || error instanceof CatalogSellerNotFoundError;
}

function mapOption(product: CatalogProduct, option: CatalogProduct["options"][number]): ProductOptionGroup {
  return {
    key: option.optionId,
    label: option.label,
    required: option.required,
    options: option.values
      .filter((value) => value.isAvailable)
      .sort((left, right) => left.position - right.position)
      .map((value) => value.label),
    valueConfigurations: [...option.values]
      .sort((left, right) => left.position - right.position)
      .map((value) => ({
        key: value.valueId,
        canonicalValue: value.label,
        label: value.label,
        enabled: value.isAvailable,
        available: value.isAvailable,
        order: value.position,
      })),
    display: option.values.length <= 3 ? "buttons" : "list",
    askOrder: option.position,
  };
}

/** Maps only the Catalog fields already representable by the approved runtime product contract. */
export function mapCatalogProductToRuntimeContext(product: CatalogProduct): ProductContext | undefined {
  if (product.price.currencyCode !== "MAD") return undefined;
  return {
    sellerId: product.sellerId,
    productId: product.productId,
    name: product.name,
    description: product.description,
    price: product.price.amountMinor / 100,
    currency: "MAD",
    active: product.availability === "available",
    images: [],
    benefits: [],
    optionGroups: product.options
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((option) => mapOption(product, option)),
    infoMenu: [],
    stock: {
      enabled: true,
      status: product.availability === "available" ? "AVAILABLE" : "OUT_OF_STOCK",
    },
  };
}

export class RuntimeCatalogReader {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly mode: RuntimeReadMode,
  ) {}

  async resolve(input: Readonly<{
    sellerId: string;
    productId: string;
    legacyProductContext: ProductContext;
  }>): Promise<RuntimeCatalogReadResult> {
    if (this.mode === "disabled") {
      return { productContext: input.legacyProductContext, source: "legacy", fallbackReason: "disabled" };
    }

    try {
      const tenant = createTenantContext(input.sellerId);
      const product = await this.catalogService.getProduct(tenant, input.productId);
      if (!product) return { productContext: input.legacyProductContext, source: "legacy", fallbackReason: "not_found" };
      const mapped = mapCatalogProductToRuntimeContext(product);
      if (!mapped) return { productContext: input.legacyProductContext, source: "legacy", fallbackReason: "persistence_error" };
      return { productContext: mapped, source: "persistence" };
    } catch (error) {
      if (!isSafeCatalogReadError(error)) throw error;
      return {
        productContext: input.legacyProductContext,
        source: "legacy",
        fallbackReason: error instanceof InvalidTenantContextError ? "invalid_tenant" : "database_unavailable",
      };
    }
  }
}
