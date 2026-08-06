import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabaseMigrationStatus,
  getDatabasePoolState,
  runDatabaseMigrations,
} from "../../../infrastructure/database";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { CatalogService } from "../application/catalog.service";
import type { CatalogProductInput } from "../domain/catalog-product";
import { CatalogPersistenceError, CatalogSellerNotFoundError, CatalogValidationError, ProductAliasAlreadyExistsError, ProductAlreadyExistsError, ProductNotFoundError } from "../domain/catalog.errors";
import { PostgreSqlCatalogRepository } from "../infrastructure/postgresql/postgresql-catalog.repository";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
const cases: TestCase[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function uniqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function product(productId: string, overrides: Partial<CatalogProductInput> = {}): CatalogProductInput {
  return {
    productId: ` ${productId} `,
    name: "  Sandale premium  ",
    description: "  Test catalogue  ",
    price: { amountMinor: 23_300, currencyCode: "MAD" },
    availability: "available",
    images: [],
    aliases: [],
    offers: [],
    options: [
      {
        optionId: " color ",
        label: " Couleur ",
        required: true,
        position: 1,
        values: [
          { valueId: "pink", label: " Rose ", position: 2, isAvailable: true },
          { valueId: "black", label: " Noir ", position: 0, isAvailable: false },
        ],
      },
      {
        optionId: " size ",
        label: " Taille ",
        required: true,
        position: 0,
        values: [
          { valueId: "38", label: " 38 ", position: 1, isAvailable: true },
          { valueId: "37", label: " 37 ", position: 0, isAvailable: true },
        ],
      },
    ],
    ...overrides,
  };
}

function imageKey(sellerId: string, stem: string, extension = "png"): string {
  return `product-images/${sellerId}/${stem.padEnd(32, "0").slice(0, 32)}.${extension}`;
}

function authorityChildren(sellerId: string): Pick<CatalogProductInput, "images" | "aliases" | "offers"> {
  return {
    images: [
      { objectKey: imageKey(sellerId, "b2"), mimeType: "image/png", position: 1 },
      { objectKey: imageKey(sellerId, "a1", "jpg"), mimeType: "image/jpeg", position: 0 },
    ],
    aliases: ["  Sandale Femme  ", "Sandale d'ete"],
    offers: [
      { offerId: "offer-later", label: " Deux articles ", requiredItemCount: 2, totalPriceAmountMinor: 40_000, active: true, allowMixedOptions: false, priority: 10, startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-08-31T00:00:00.000Z" },
      { offerId: "offer-first", label: " Offre d'essai ", requiredItemCount: 1, totalPriceAmountMinor: 20_000, active: true, allowMixedOptions: true, priority: 0 },
    ],
  };
}

async function expectsError(callback: () => Promise<unknown>, expected: new () => Error): Promise<boolean> {
  try {
    await callback();
    return false;
  } catch (error) {
    return error instanceof expected;
  }
}

async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({
    text: "DELETE FROM product_option_values WHERE seller_id = ANY($1::varchar[])",
    values: [sellerIds],
  });
  await executeDatabaseQuery({
    text: "DELETE FROM product_options WHERE seller_id = ANY($1::varchar[])",
    values: [sellerIds],
  });
  await executeDatabaseQuery({
    text: "DELETE FROM products WHERE seller_id = ANY($1::varchar[])",
    values: [sellerIds],
  });
  await executeDatabaseQuery({
    text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])",
    values: [sellerIds],
  });
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Catalog module import does not initialize a pool", !getDatabasePoolState().initialized);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const repository = new PostgreSqlCatalogRepository();
  const service = new CatalogService(repository);
  const sellerA = uniqueId("seller_phase7c");
  const sellerB = uniqueId("seller_phase7c");
  const unknownSeller = uniqueId("seller_phase7c");
  const baseProductId = uniqueId("product_phase7c");
  const secondProductId = `${baseProductId}_b`;
  const thirdProductId = `${baseProductId}_c`;

  try {
    const invalidInputs: readonly CatalogProductInput[] = [
      product(baseProductId, { productId: undefined }),
      product(baseProductId, { productId: "   " }),
      product(baseProductId, { productId: "x".repeat(129) }),
      product(baseProductId, { name: undefined }),
      product(baseProductId, { name: " " }),
      product(baseProductId, { price: { amountMinor: -1, currencyCode: "MAD" } }),
      product(baseProductId, { price: { amountMinor: 1.5, currencyCode: "MAD" } }),
      product(baseProductId, { price: { amountMinor: Number.MAX_SAFE_INTEGER + 1, currencyCode: "MAD" } }),
      product(baseProductId, { price: { amountMinor: 100, currencyCode: "mad" } }),
      product(baseProductId, { availability: "limited" }),
      product(baseProductId, { images: [{ objectKey: imageKey(sellerA, "a1"), mimeType: "image/gif", position: 0 }] }),
      product(baseProductId, { images: [{ objectKey: "https://example.test/image.png", mimeType: "image/png", position: 0 }] }),
      product(baseProductId, { images: [{ objectKey: imageKey(sellerA, "a2"), mimeType: "image/png", position: 0 }, { objectKey: imageKey(sellerA, "b3"), mimeType: "image/png", position: 0 }] }),
      product(baseProductId, { aliases: ["Sandale Femme", "sandale   femme"] }),
      product(baseProductId, { aliases: ["alias\u0000with-control"] }),
      product(baseProductId, { offers: [{ offerId: "bad-offer", label: "Bad", requiredItemCount: 0, totalPriceAmountMinor: 100, active: true, allowMixedOptions: false }] }),
      product(baseProductId, { offers: [{ offerId: "bad-window", label: "Bad", requiredItemCount: 1, totalPriceAmountMinor: 100, active: true, allowMixedOptions: false, startsAt: "2026-08-02T00:00:00.000Z", endsAt: "2026-08-01T00:00:00.000Z" }] }),
      product(baseProductId, { options: [{ optionId: "a", label: "A", required: true, position: 0, values: [] }, { optionId: "a", label: "B", required: false, position: 1, values: [] }] }),
      product(baseProductId, { options: [{ optionId: "a", label: "A", required: true, position: 0, values: [] }, { optionId: "b", label: "B", required: false, position: 0, values: [] }] }),
      product(baseProductId, { options: [{ optionId: "a", label: "A", required: true, position: 0, values: [{ valueId: "x", label: "X", position: 0, isAvailable: true }, { valueId: "x", label: "Y", position: 1, isAvailable: true }] }] }),
      product(baseProductId, { options: [{ optionId: "a", label: "A", required: true, position: 0, values: [{ valueId: "x", label: "X", position: 0, isAvailable: true }, { valueId: "y", label: "Y", position: 0, isAvailable: true }] }] }),
    ];
    const invalidNames = ["missing product ID", "blank product ID", "long product ID", "missing name", "blank name", "negative price", "fractional money", "unsafe money", "invalid currency", "invalid availability", "invalid image MIME type", "invalid image object key", "duplicate image position", "duplicate normalized alias", "alias control character", "invalid offer count", "invalid offer window", "duplicate option ID", "duplicate option position", "duplicate value ID", "duplicate value position"];
    for (let index = 0; index < invalidInputs.length; index += 1) {
      add(`Validation rejects ${invalidNames[index]}`, await expectsError(() => service.createProduct(createTenantContext(sellerA), invalidInputs[index]), CatalogValidationError));
    }

    const firstRun = await runDatabaseMigrations();
    const secondRun = await runDatabaseMigrations();
    const status = await getDatabaseMigrationStatus();
    add("Catalog migration 0016 is applied explicitly", status.applied.includes("0016"));
    add("Running migrations again applies nothing twice", firstRun.pending.length === 0 && secondRun.applied.length === 0);

    await sellerService.createSeller(sellerA);
    sellerIds.push(sellerA);
    await sellerService.createSeller(sellerB);
    sellerIds.push(sellerB);
    const tenantA = createTenantContext(sellerA);
    const tenantB = createTenantContext(sellerB);

    const created = await service.createProduct(tenantA, product(baseProductId, authorityChildren(sellerA)));
    add("Valid Product data is trimmed and accepted", created.productId === baseProductId && created.name === "Sandale premium" && created.description === "Test catalogue");
    add("Product aggregate can be created", created.sellerId === sellerA && created.price.amountMinor === 23_300);
    add("Product root fields are returned correctly", created.price.currencyCode === "MAD" && created.availability === "available" && created.createdAt instanceof Date);
    add("Options are returned in deterministic position order", created.options.map((option) => option.optionId).join("|") === "size|color");
    add("Values are returned in deterministic position order", created.options[0]?.values.map((value) => value.valueId).join("|") === "37|38");
    add("Images are stored and returned in deterministic position order", created.images.map((image) => image.position).join("|") === "0|1" && created.images[0]?.objectKey === imageKey(sellerA, "a1", "jpg"));
    add("Aliases are trimmed and normalized deterministically", created.aliases.map((alias) => alias.normalizedAlias).join("|") === "sandale d'ete|sandale femme");
    add("Offers are stored with parent currency and deterministic ordering", created.offers.map((offer) => offer.offerId).join("|") === "offer-first|offer-later" && created.offers[0]?.currencyCode === "MAD" && created.offers[1]?.totalPriceAmountMinor === 40_000);
    add("Product can contain zero options", (await service.createProduct(tenantA, product(secondProductId, { options: [] }))).options.length === 0);
    const noChildren = await service.getProduct(tenantA, secondProductId);
    add("Products without authority children remain valid", noChildren?.images.length === 0 && noChildren.aliases.length === 0 && noChildren.offers.length === 0);
    add("Product can contain arbitrary option names beyond size/color", (await service.createProduct(tenantA, product(thirdProductId, { options: [{ optionId: "capacity", label: "Capacite", required: false, position: 0, values: [{ valueId: "128gb", label: "128 GB", position: 0, isAvailable: true }] }] }))).options[0]?.optionId === "capacity");
    add("Option-value availability is persisted", created.options[1]?.values[0]?.isAvailable === false);
    add("Product can be found by TenantContext and productId", (await service.getProduct(tenantA, baseProductId))?.productId === baseProductId);
    add("Unknown Product returns null", await service.getProduct(tenantA, uniqueId("unknown_product")) === null);
    add("Seller A cannot read Seller B Product", await service.getProduct(tenantB, baseProductId) === null);
    const sellerBProduct = await service.createProduct(tenantB, product(baseProductId, { aliases: ["Sandale Femme"] }));
    add("The same productId may exist for two different Sellers", sellerBProduct.sellerId === sellerB);
    add("The same normalized alias may exist for different Sellers", sellerBProduct.aliases[0]?.normalizedAlias === "sandale femme");
    add("Duplicate Product in the same Seller maps to ProductAlreadyExistsError", await expectsError(() => service.createProduct(tenantA, product(baseProductId)), ProductAlreadyExistsError));
    add("Unknown Seller creation maps to a safe typed error", await expectsError(() => service.createProduct(createTenantContext(unknownSeller), product(uniqueId("unknown_seller_product"))), CatalogSellerNotFoundError));

    const listed = await service.listProducts(tenantA, { limit: 2 });
    add("Product list is tenant-scoped", listed.products.every((entry) => entry.sellerId === sellerA));
    add("Product list is bounded", listed.products.length === 2);
    const next = await service.listProducts(tenantA, { limit: 2, cursor: listed.nextCursor });
    add("Product list pagination is deterministic", listed.nextCursor !== undefined && next.products.length === 1 && listed.products[1]?.productId < next.products[0]?.productId);

    const beforeAvailabilityUpdate = (await service.getProduct(tenantA, baseProductId))!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const unavailable = await service.setProductAvailability(tenantA, baseProductId, "unavailable");
    add("Product availability can be changed atomically", unavailable.availability === "unavailable");
    add("Unknown Product availability update returns typed not-found", await expectsError(() => service.setProductAvailability(tenantA, uniqueId("missing_product"), "available"), ProductNotFoundError));

    const replacement = await service.replaceProduct(tenantA, product(baseProductId, {
      name: "Replacement",
      price: { amountMinor: 19_900, currencyCode: "MAD" },
      options: [{ optionId: "material", label: "Material", required: false, position: 0, values: [{ valueId: "leather", label: "Leather", position: 0, isAvailable: true }] }],
      images: [{ objectKey: imageKey(sellerA, "c4", "webp"), mimeType: "image/webp", position: 0 }],
      aliases: ["Replacement Alias"],
      offers: [{ offerId: "replacement-offer", label: "Replacement offer", requiredItemCount: 2, totalPriceAmountMinor: 35_000, active: true, allowMixedOptions: true }],
    }));
    add("Product aggregate replacement is atomic", replacement.name === "Replacement" && replacement.options[0]?.optionId === "material" && replacement.options.length === 1);
    add("Product replacement atomically replaces authority children", replacement.images[0]?.mimeType === "image/webp" && replacement.aliases[0]?.normalizedAlias === "replacement alias" && replacement.offers[0]?.currencyCode === "MAD");
    add("Product replacement updates updatedAt", replacement.updatedAt.getTime() >= beforeAvailabilityUpdate.updatedAt.getTime());
    add("Product replacement does not affect another Seller", (await service.getProduct(tenantB, baseProductId))?.name === "Sandale premium");

    const ownAliasReplacement = await service.replaceProduct(tenantA, product(baseProductId, {
      name: "Replacement alias retained",
      options: replacement.options,
      images: replacement.images,
      aliases: ["Replacement Alias"],
      offers: replacement.offers.map(({ currencyCode: _currencyCode, ...offer }) => offer),
    }));
    add("A Product may retain its own normalized alias on replacement", ownAliasReplacement.aliases[0]?.normalizedAlias === "replacement alias");

    const aliasOwnerId = uniqueId("alias_owner");
    await service.createProduct(tenantA, product(aliasOwnerId, { options: [], aliases: ["Reserved Alias"] }));
    add("Duplicate normalized aliases in one Seller map to a typed conflict", await expectsError(() => service.createProduct(tenantA, product(uniqueId("alias_conflict"), { options: [], aliases: ["reserved   alias"] })), ProductAliasAlreadyExistsError));
    add("A failed replacement rolls back Product and authority children", await expectsError(() => service.replaceProduct(tenantA, product(baseProductId, { name: "Must roll back", options: [], aliases: ["Reserved Alias"] })), ProductAliasAlreadyExistsError));
    const afterFailedReplacement = await service.getProduct(tenantA, baseProductId);
    add("Failed authority-child replacement leaves prior aggregate intact", afterFailedReplacement?.name === "Replacement alias retained" && afterFailedReplacement.images[0]?.mimeType === "image/webp" && afterFailedReplacement.aliases[0]?.normalizedAlias === "replacement alias" && afterFailedReplacement.offers[0]?.offerId === "replacement-offer");

    const failedAggregateId = uniqueId("failed_aggregate");
    const invalidAggregate = product(failedAggregateId, { options: [{ optionId: "one", label: "One", required: true, position: 0, values: [] }, { optionId: "two", label: "Two", required: true, position: 0, values: [] }] });
    await expectsError(() => repository.createProduct(tenantA, invalidAggregate as never), CatalogPersistenceError);
    add("A failed aggregate write leaves no partial Product/options/values", await service.getProduct(tenantA, failedAggregateId) === null);

    const constraints = await executeDatabaseQuery<{ constraint_name: string }>({
      text: `SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = 'public' AND table_name IN ('products', 'product_options', 'product_option_values') ORDER BY constraint_name ASC`,
    });
    add("SQL uses composite tenant keys", constraints.rows.some((row) => row.constraint_name === "product_options_product_fk") && constraints.rows.some((row) => row.constraint_name === "product_option_values_option_fk"));
    const columns = await executeDatabaseQuery<{ table_name: string; column_name: string }>({
      text: `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('products', 'product_options', 'product_option_values') ORDER BY table_name ASC, ordinal_position ASC`,
    });
    const expectedColumns = "product_option_values:seller_id|product_option_values:product_id|product_option_values:option_id|product_option_values:value_id|product_option_values:label|product_option_values:position|product_option_values:is_available|product_options:seller_id|product_options:product_id|product_options:option_id|product_options:label|product_options:is_required|product_options:position|products:seller_id|products:product_id|products:name|products:description|products:price_amount_minor|products:currency_code|products:availability_status|products:created_at|products:updated_at";
    add("Catalog tables contain only expected explicit columns and constraints", columns.rows.map((row) => `${row.table_name}:${row.column_name}`).join("|") === expectedColumns && constraints.rows.length > 0);
    const authorityConstraints = await executeDatabaseQuery<{ constraint_name: string }>({
      text: `SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = 'public' AND table_name IN ('product_images', 'product_aliases', 'product_offers') ORDER BY constraint_name ASC`,
    });
    const authorityColumns = await executeDatabaseQuery<{ table_name: string; column_name: string }>({
      text: `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('product_images', 'product_aliases', 'product_offers') ORDER BY table_name ASC, ordinal_position ASC`,
    });
    const expectedAuthorityColumns = "product_aliases:seller_id|product_aliases:product_id|product_aliases:alias|product_aliases:normalized_alias|product_images:seller_id|product_images:product_id|product_images:position|product_images:object_key|product_images:mime_type|product_offers:seller_id|product_offers:product_id|product_offers:offer_id|product_offers:label|product_offers:required_item_count|product_offers:total_price_amount_minor|product_offers:is_active|product_offers:allow_mixed_options|product_offers:priority|product_offers:starts_at|product_offers:ends_at";
    add("Catalog authority tables use composite tenant keys and explicit columns", authorityColumns.rows.map((row) => `${row.table_name}:${row.column_name}`).join("|") === expectedAuthorityColumns && authorityConstraints.rows.some((row) => row.constraint_name === "product_images_product_fk") && authorityConstraints.rows.some((row) => row.constraint_name === "product_aliases_product_fk") && authorityConstraints.rows.some((row) => row.constraint_name === "product_offers_product_fk"));
  } finally {
    await cleanup();
    const remaining = sellerIds.length ? await executeDatabaseQuery<{ count: string }>({ text: "SELECT COUNT(*)::text AS count FROM products WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    add("Test Catalog rows are cleaned up", remaining.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : "Phase 7C catalog persistence test failed safely." })}\n`);
  process.exitCode = 1;
});
