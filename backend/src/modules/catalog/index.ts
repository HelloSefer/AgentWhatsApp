export { CatalogService } from "./application/catalog.service";
export type { CatalogProductList, CatalogRepository } from "./contracts/catalog.repository";
export type { CatalogOption, CatalogOptionValue } from "./domain/catalog-option";
export type { CatalogProduct, CatalogProductDraft, CatalogProductInput, ProductAvailability } from "./domain/catalog-product";
export { CatalogPersistenceError, CatalogSellerNotFoundError, CatalogValidationError, ProductAlreadyExistsError, ProductNotFoundError } from "./domain/catalog.errors";
export { validateCatalogProductId, validateCatalogProductInput, validateProductAvailability } from "./domain/catalog.validation";
export type { Money } from "./domain/money";
export { validateMoney } from "./domain/money";
export { PostgreSqlCatalogRepository, postgreSqlCatalogRepository } from "./infrastructure/postgresql/postgresql-catalog.repository";
