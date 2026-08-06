import {
  DatabaseQueryError,
  executeDatabaseQuery,
  type DatabaseQueryExecutor,
  type TenantContext,
  withTransaction,
} from "../../../../infrastructure/database";
import type { CatalogProductList, CatalogRepository } from "../../contracts/catalog.repository";
import type { CatalogProduct, CatalogProductDraft, ProductAvailability } from "../../domain/catalog-product";
import {
  CatalogPersistenceError,
  CatalogSellerNotFoundError,
  ProductAliasAlreadyExistsError,
  ProductAlreadyExistsError,
  ProductNotFoundError,
} from "../../domain/catalog.errors";
import { mapCatalogProducts, type ProductAliasRow, type ProductImageRow, type ProductOfferRow, type ProductOptionRow, type ProductOptionValueRow, type ProductRow } from "./catalog-row.mapper";

function databaseCode(error: unknown): string | undefined {
  if (!(error instanceof DatabaseQueryError) || typeof error.cause !== "object" || error.cause === null || !("code" in error.cause)) return undefined;
  return typeof error.cause.code === "string" ? error.cause.code : undefined;
}

function databaseConstraint(error: unknown): string | undefined {
  if (!(error instanceof DatabaseQueryError) || typeof error.cause !== "object" || error.cause === null || !("constraint" in error.cause)) return undefined;
  return typeof error.cause.constraint === "string" ? error.cause.constraint : undefined;
}

function mapWriteError(error: unknown): never {
  if (error instanceof CatalogPersistenceError || error instanceof ProductAlreadyExistsError || error instanceof ProductAliasAlreadyExistsError || error instanceof CatalogSellerNotFoundError || error instanceof ProductNotFoundError) throw error;
  if (databaseCode(error) === "23505" && databaseConstraint(error) === "product_aliases_pkey") throw new ProductAliasAlreadyExistsError();
  if (databaseCode(error) === "23505") throw new ProductAlreadyExistsError();
  if (databaseCode(error) === "23503") throw new CatalogSellerNotFoundError();
  throw new CatalogPersistenceError(error);
}

const PRODUCT_COLUMNS = "seller_id, product_id, name, description, price_amount_minor, currency_code, availability_status, created_at, updated_at";
const OPTION_COLUMNS = "seller_id, product_id, option_id, label, is_required, position";
const VALUE_COLUMNS = "seller_id, product_id, option_id, value_id, label, position, is_available";
const IMAGE_COLUMNS = "seller_id, product_id, position, object_key, mime_type";
const ALIAS_COLUMNS = "seller_id, product_id, alias, normalized_alias";
const OFFER_COLUMNS = "seller_id, product_id, offer_id, label, required_item_count, total_price_amount_minor, is_active, allow_mixed_options, priority, starts_at, ends_at";

async function loadProducts(
  executor: DatabaseQueryExecutor,
  sellerId: string,
  productIds: readonly string[],
): Promise<readonly CatalogProduct[]> {
  if (!productIds.length) return [];
  const products = await executor.execute<ProductRow>({
    text: `SELECT ${PRODUCT_COLUMNS} FROM products WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC`,
    values: [sellerId, productIds],
  });
  if (!products.rows.length) return [];
  const ids = products.rows.map((row) => row.product_id);
  const [options, values, images, aliases, offers] = await Promise.all([
    executor.execute<ProductOptionRow>({
      text: `SELECT ${OPTION_COLUMNS} FROM product_options WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, position ASC`,
      values: [sellerId, ids],
    }),
    executor.execute<ProductOptionValueRow>({
      text: `SELECT ${VALUE_COLUMNS} FROM product_option_values WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, option_id ASC, position ASC`,
      values: [sellerId, ids],
    }),
    executor.execute<ProductImageRow>({
      text: `SELECT ${IMAGE_COLUMNS} FROM product_images WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, position ASC`,
      values: [sellerId, ids],
    }),
    executor.execute<ProductAliasRow>({
      text: `SELECT ${ALIAS_COLUMNS} FROM product_aliases WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, normalized_alias ASC`,
      values: [sellerId, ids],
    }),
    executor.execute<ProductOfferRow>({
      text: `SELECT ${OFFER_COLUMNS} FROM product_offers WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, priority ASC NULLS FIRST, required_item_count ASC, offer_id ASC`,
      values: [sellerId, ids],
    }),
  ]);
  return mapCatalogProducts(products.rows, options.rows, values.rows, images.rows, aliases.rows, offers.rows);
}

async function insertOptions(executor: DatabaseQueryExecutor, sellerId: string, product: CatalogProductDraft): Promise<void> {
  for (const option of product.options) {
    await executor.execute({
      text: `INSERT INTO product_options (seller_id, product_id, option_id, label, is_required, position) VALUES ($1, $2, $3, $4, $5, $6)`,
      values: [sellerId, product.productId, option.optionId, option.label, option.required, option.position],
    });
    for (const value of option.values) {
      await executor.execute({
        text: `INSERT INTO product_option_values (seller_id, product_id, option_id, value_id, label, position, is_available) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        values: [sellerId, product.productId, option.optionId, value.valueId, value.label, value.position, value.isAvailable],
      });
    }
  }
}

async function insertProductChildren(executor: DatabaseQueryExecutor, sellerId: string, product: CatalogProductDraft): Promise<void> {
  await insertOptions(executor, sellerId, product);
  for (const image of product.images) {
    await executor.execute({
      text: "INSERT INTO product_images (seller_id, product_id, position, object_key, mime_type) VALUES ($1, $2, $3, $4, $5)",
      values: [sellerId, product.productId, image.position, image.objectKey, image.mimeType],
    });
  }
  for (const alias of product.aliases) {
    await executor.execute({
      text: "INSERT INTO product_aliases (seller_id, product_id, alias, normalized_alias) VALUES ($1, $2, $3, $4)",
      values: [sellerId, product.productId, alias.alias, alias.normalizedAlias],
    });
  }
  for (const offer of product.offers) {
    await executor.execute({
      text: "INSERT INTO product_offers (seller_id, product_id, offer_id, label, required_item_count, total_price_amount_minor, is_active, allow_mixed_options, priority, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)",
      values: [sellerId, product.productId, offer.offerId, offer.label, offer.requiredItemCount, offer.totalPriceAmountMinor, offer.active, offer.allowMixedOptions, offer.priority ?? null, offer.startsAt ?? null, offer.endsAt ?? null],
    });
  }
}

async function loadOne(executor: DatabaseQueryExecutor, tenant: TenantContext, productId: string): Promise<CatalogProduct | null> {
  const products = await loadProducts(executor, tenant.sellerId, [productId]);
  return products[0] || null;
}

export class PostgreSqlCatalogRepository implements CatalogRepository {
  async createProduct(tenant: TenantContext, product: CatalogProductDraft): Promise<CatalogProduct> {
    try {
      return await withTransaction(async (transaction) => {
        await transaction.execute({
          text: `INSERT INTO products (seller_id, product_id, name, description, price_amount_minor, currency_code, availability_status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          values: [tenant.sellerId, product.productId, product.name, product.description || null, product.price.amountMinor, product.price.currencyCode, product.availability],
        });
        await insertProductChildren(transaction, tenant.sellerId, product);
        const created = await loadOne(transaction, tenant, product.productId);
        if (!created) throw new CatalogPersistenceError();
        return created;
      });
    } catch (error) {
      return mapWriteError(error);
    }
  }

  async findProduct(tenant: TenantContext, productId: string): Promise<CatalogProduct | null> {
    try {
      return await loadOne({ execute: executeDatabaseQuery }, tenant, productId);
    } catch (error) {
      throw new CatalogPersistenceError(error);
    }
  }

  async listProducts(tenant: TenantContext, input: Readonly<{ limit: number; cursor?: string }>): Promise<CatalogProductList> {
    try {
      const result = await executeDatabaseQuery<ProductRow>({
        text: `SELECT ${PRODUCT_COLUMNS} FROM products WHERE seller_id = $1 AND ($2::varchar IS NULL OR product_id > $2) ORDER BY product_id ASC LIMIT $3`,
        values: [tenant.sellerId, input.cursor || null, input.limit + 1],
      });
      const pageRows = result.rows.slice(0, input.limit);
      const pageIds = pageRows.map((row) => row.product_id);
      if (!pageIds.length) return { products: [] };
      const [options, values, images, aliases, offers] = await Promise.all([
        executeDatabaseQuery<ProductOptionRow>({ text: `SELECT ${OPTION_COLUMNS} FROM product_options WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, position ASC`, values: [tenant.sellerId, pageIds] }),
        executeDatabaseQuery<ProductOptionValueRow>({ text: `SELECT ${VALUE_COLUMNS} FROM product_option_values WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, option_id ASC, position ASC`, values: [tenant.sellerId, pageIds] }),
        executeDatabaseQuery<ProductImageRow>({ text: `SELECT ${IMAGE_COLUMNS} FROM product_images WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, position ASC`, values: [tenant.sellerId, pageIds] }),
        executeDatabaseQuery<ProductAliasRow>({ text: `SELECT ${ALIAS_COLUMNS} FROM product_aliases WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, normalized_alias ASC`, values: [tenant.sellerId, pageIds] }),
        executeDatabaseQuery<ProductOfferRow>({ text: `SELECT ${OFFER_COLUMNS} FROM product_offers WHERE seller_id = $1 AND product_id = ANY($2::varchar[]) ORDER BY product_id ASC, priority ASC NULLS FIRST, required_item_count ASC, offer_id ASC`, values: [tenant.sellerId, pageIds] }),
      ]);
      const products = mapCatalogProducts(pageRows, options.rows, values.rows, images.rows, aliases.rows, offers.rows);
      return { products, nextCursor: result.rows.length > input.limit ? pageRows.at(-1)?.product_id : undefined };
    } catch (error) {
      throw new CatalogPersistenceError(error);
    }
  }

  async replaceProduct(tenant: TenantContext, product: CatalogProductDraft): Promise<CatalogProduct> {
    try {
      return await withTransaction(async (transaction) => {
        const updated = await transaction.execute<ProductRow>({
          text: `UPDATE products SET name = $3, description = $4, price_amount_minor = $5, currency_code = $6, availability_status = $7, updated_at = NOW() WHERE seller_id = $1 AND product_id = $2 RETURNING ${PRODUCT_COLUMNS}`,
          values: [tenant.sellerId, product.productId, product.name, product.description || null, product.price.amountMinor, product.price.currencyCode, product.availability],
        });
        if (!updated.rows[0]) throw new ProductNotFoundError();
        await transaction.execute({ text: "DELETE FROM product_options WHERE seller_id = $1 AND product_id = $2", values: [tenant.sellerId, product.productId] });
        await transaction.execute({ text: "DELETE FROM product_images WHERE seller_id = $1 AND product_id = $2", values: [tenant.sellerId, product.productId] });
        await transaction.execute({ text: "DELETE FROM product_aliases WHERE seller_id = $1 AND product_id = $2", values: [tenant.sellerId, product.productId] });
        await transaction.execute({ text: "DELETE FROM product_offers WHERE seller_id = $1 AND product_id = $2", values: [tenant.sellerId, product.productId] });
        await insertProductChildren(transaction, tenant.sellerId, product);
        const replacement = await loadOne(transaction, tenant, product.productId);
        if (!replacement) throw new CatalogPersistenceError();
        return replacement;
      });
    } catch (error) {
      return mapWriteError(error);
    }
  }

  async setProductAvailability(tenant: TenantContext, productId: string, availability: ProductAvailability): Promise<CatalogProduct> {
    try {
      return await withTransaction(async (transaction) => {
        const updated = await transaction.execute<ProductRow>({
          text: `UPDATE products SET availability_status = $3, updated_at = NOW() WHERE seller_id = $1 AND product_id = $2 RETURNING ${PRODUCT_COLUMNS}`,
          values: [tenant.sellerId, productId, availability],
        });
        if (!updated.rows[0]) throw new ProductNotFoundError();
        const product = await loadOne(transaction, tenant, productId);
        if (!product) throw new CatalogPersistenceError();
        return product;
      });
    } catch (error) {
      return mapWriteError(error);
    }
  }
}

export const postgreSqlCatalogRepository = new PostgreSqlCatalogRepository();
