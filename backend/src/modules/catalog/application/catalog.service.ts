import type { TenantContext } from "../../../infrastructure/database";
import type { CatalogRepository, CatalogProductList } from "../contracts/catalog.repository";
import type { CatalogProduct, CatalogProductInput, ProductAvailability } from "../domain/catalog-product";
import { validateCatalogCursor, validateCatalogListLimit, validateCatalogProductId, validateCatalogProductInput, validateProductAvailability } from "../domain/catalog.validation";

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  async createProduct(tenant: TenantContext, input: CatalogProductInput): Promise<CatalogProduct> {
    return this.repository.createProduct(tenant, validateCatalogProductInput(input));
  }

  async getProduct(tenant: TenantContext, productId: unknown): Promise<CatalogProduct | null> {
    return this.repository.findProduct(tenant, validateCatalogProductId(productId));
  }

  async listProducts(tenant: TenantContext, input: Readonly<{ limit?: unknown; cursor?: unknown }> = {}): Promise<CatalogProductList> {
    return this.repository.listProducts(tenant, {
      limit: validateCatalogListLimit(input.limit),
      cursor: validateCatalogCursor(input.cursor),
    });
  }

  async replaceProduct(tenant: TenantContext, input: CatalogProductInput): Promise<CatalogProduct> {
    return this.repository.replaceProduct(tenant, validateCatalogProductInput(input));
  }

  async setProductAvailability(tenant: TenantContext, productId: unknown, availability: unknown): Promise<CatalogProduct> {
    return this.repository.setProductAvailability(tenant, validateCatalogProductId(productId), validateProductAvailability(availability));
  }
}
