import type { TenantContext } from "../../../infrastructure/database";
import type { CatalogProduct, CatalogProductDraft, ProductAvailability } from "../domain/catalog-product";

export type CatalogProductList = Readonly<{
  products: readonly CatalogProduct[];
  nextCursor?: string;
}>;

export interface CatalogRepository {
  createProduct(tenant: TenantContext, product: CatalogProductDraft): Promise<CatalogProduct>;
  findProduct(tenant: TenantContext, productId: string): Promise<CatalogProduct | null>;
  listProducts(tenant: TenantContext, input: Readonly<{ limit: number; cursor?: string }>): Promise<CatalogProductList>;
  replaceProduct(tenant: TenantContext, product: CatalogProductDraft): Promise<CatalogProduct>;
  setProductAvailability(tenant: TenantContext, productId: string, availability: ProductAvailability): Promise<CatalogProduct>;
}
