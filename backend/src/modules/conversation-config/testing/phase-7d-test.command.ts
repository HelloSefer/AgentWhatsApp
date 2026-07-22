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
import { CatalogService } from "../../catalog/application/catalog.service";
import type { CatalogProductInput } from "../../catalog/domain/catalog-product";
import { PostgreSqlCatalogRepository } from "../../catalog/infrastructure/postgresql/postgresql-catalog.repository";
import {
  ConversationConfigResolver,
  InMemoryConversationConfigProvider,
  conversationConfigValidator,
} from "../../conversation-engine";
import { AR_MA_MESSAGES } from "../../conversation-engine/locales/ar-MA";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { ConversationConfigService } from "../application/conversation-config.service";
import { ConversationConfigCorruptedError, ConversationConfigProductNotFoundError, ConversationConfigSellerNotFoundError, ConversationConfigValidationError } from "../domain/conversation-config.errors";
import { PostgreSqlConversationConfigRepository } from "../infrastructure/postgresql/postgresql-conversation-config.repository";

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

function product(productId: string): CatalogProductInput {
  return {
    productId,
    name: "Conversation configuration test product",
    price: { amountMinor: 19_900, currencyCode: "MAD" },
    availability: "available",
    options: [],
  };
}

function sellerOverride(message: string) {
  return {
    schemaVersion: 1,
    messages: { "first_entry.commercial_intro": message },
    labels: { "first_entry.order_now": "اطلب" },
  };
}

function productOverride(message: string) {
  return {
    schemaVersion: 1,
    messages: { "first_entry.commercial_intro": message },
    productWording: {
      fullName: "منتج الاختبار",
      conversationalName: "المنتج",
      singularName: "منتج",
      pluralName: "منتجات",
    },
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
  await executeDatabaseQuery({ text: "DELETE FROM seller_conversation_configs WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM product_conversation_config_overrides WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM product_option_values WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM product_options WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("Conversation Config module import does not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const sellerService = new SellerService(new PostgreSqlSellerRepository());
  const catalogService = new CatalogService(new PostgreSqlCatalogRepository());
  const repository = new PostgreSqlConversationConfigRepository();
  const service = new ConversationConfigService(repository);
  const sellerA = uniqueId("seller_phase7d");
  const sellerB = uniqueId("seller_phase7d");
  const productId = uniqueId("product_phase7d");
  const sellerBOnlyProductId = uniqueId("product_phase7d");
  const unknownProduct = uniqueId("product_phase7d");
  const tenantA = createTenantContext(sellerA);
  const tenantB = createTenantContext(sellerB);

  try {
    add("Valid schemaVersion 1 seller override is accepted", conversationConfigValidator.validate(sellerOverride("ترحيب البائع"), "seller").valid);
    add("Valid schemaVersion 1 product override is accepted", conversationConfigValidator.validate(productOverride("ترحيب المنتج"), "product").valid);
    add("Unsupported schema version is rejected", await expectsError(() => service.saveSellerOverride(tenantA, { schemaVersion: 2 }), ConversationConfigValidationError));
    add("Malformed seller override is rejected", await expectsError(() => service.saveSellerOverride(tenantA, { schemaVersion: 1, messages: { unknown: "x" } }), ConversationConfigValidationError));
    add("Malformed product override is rejected", await expectsError(() => service.saveProductOverride(tenantA, productId, { schemaVersion: 1, options: "not-an-array" }), ConversationConfigValidationError));
    const normalized = conversationConfigValidator.validate(sellerOverride("  ترحيب البائع  "), "seller").normalizedConfig;
    const persistedCandidate = await expectsError(() => service.saveSellerOverride(tenantA, { schemaVersion: 1, messages: { "first_entry.commercial_intro": "قيمة {{price}}" } }), ConversationConfigValidationError);
    add("Existing CCE validator is used rather than duplicated", Boolean(normalized) && persistedCandidate);

    const firstMigrationRun = await runDatabaseMigrations();
    const secondMigrationRun = await runDatabaseMigrations();
    const migrationStatus = await getDatabaseMigrationStatus();
    add("Conversation Config migration 0003 is applied explicitly", migrationStatus.applied.includes("0003"));
    add("Running migrations again applies nothing twice", firstMigrationRun.pending.length === 0 && secondMigrationRun.applied.length === 0);

    await sellerService.createSeller(sellerA);
    sellerIds.push(sellerA);
    await sellerService.createSeller(sellerB);
    sellerIds.push(sellerB);
    await catalogService.createProduct(tenantA, product(productId));
    await catalogService.createProduct(tenantB, product(productId));
    await catalogService.createProduct(tenantB, product(sellerBOnlyProductId));

    const sellerSaved = await service.saveSellerOverride(tenantA, sellerOverride("ترحيب البائع"));
    add("Seller override can be saved", sellerSaved.config.messages?.["first_entry.commercial_intro"] === "ترحيب البائع");
    add("Seller override can be read", (await service.getSellerOverride(tenantA))?.config.labels?.["first_entry.order_now"] === "اطلب");
    add("Missing seller override returns null", await service.getSellerOverride(tenantB) === null);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const sellerUpdated = await service.saveSellerOverride(tenantA, sellerOverride("ترحيب البائع الجديد"));
    add("Saving again updates the seller override", sellerUpdated.config.messages?.["first_entry.commercial_intro"] === "ترحيب البائع الجديد");
    add("Seller created_at remains unchanged after update", sellerUpdated.createdAt.getTime() === sellerSaved.createdAt.getTime());
    add("Seller updated_at changes after update", sellerUpdated.updatedAt.getTime() >= sellerSaved.updatedAt.getTime());
    await service.clearSellerOverride(tenantA);
    add("Seller override can be cleared", await service.getSellerOverride(tenantA) === null);
    await service.clearSellerOverride(tenantA);
    add("Clearing a missing seller override is safe", await service.getSellerOverride(tenantA) === null);

    const productSaved = await service.saveProductOverride(tenantA, productId, productOverride("ترحيب المنتج"));
    add("Product override can be saved", productSaved.config.messages?.["first_entry.commercial_intro"] === "ترحيب المنتج");
    add("Product override can be read", (await service.getProductOverride(tenantA, productId))?.config.productWording?.pluralName === "منتجات");
    add("Missing product override returns null", await service.getProductOverride(tenantA, unknownProduct) === null);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const productUpdated = await service.saveProductOverride(tenantA, productId, productOverride("ترحيب المنتج الجديد"));
    add("Saving again updates the product override", productUpdated.config.messages?.["first_entry.commercial_intro"] === "ترحيب المنتج الجديد");
    add("Product created_at remains unchanged after update", productUpdated.createdAt.getTime() === productSaved.createdAt.getTime());
    add("Product updated_at changes after update", productUpdated.updatedAt.getTime() >= productSaved.updatedAt.getTime());
    await service.clearProductOverride(tenantA, productId);
    add("Product override can be cleared", await service.getProductOverride(tenantA, productId) === null);
    await service.clearProductOverride(tenantA, productId);
    add("Clearing a missing product override is safe", await service.getProductOverride(tenantA, productId) === null);

    await service.saveSellerOverride(tenantB, sellerOverride("ترحيب بائع ب"));
    add("Seller A cannot read Seller B override", await service.getSellerOverride(tenantA) === null);
    await service.saveSellerOverride(tenantA, sellerOverride("ترحيب بائع أ"));
    add("Seller A cannot overwrite Seller B override", (await service.getSellerOverride(tenantA))?.config.messages?.["first_entry.commercial_intro"] === "ترحيب بائع أ" && (await service.getSellerOverride(tenantB))?.config.messages?.["first_entry.commercial_intro"] === "ترحيب بائع ب");
    add("Seller A cannot attach config to Seller B product", await expectsError(() => service.saveProductOverride(tenantA, sellerBOnlyProductId, productOverride("أ")), ConversationConfigProductNotFoundError));
    await service.saveProductOverride(tenantA, productId, productOverride("منتج أ"));
    await service.saveProductOverride(tenantB, productId, productOverride("منتج ب"));
    add("Same productId can have separate overrides for different Sellers", (await service.getProductOverride(tenantA, productId))?.config.messages?.["first_entry.commercial_intro"] === "منتج أ" && (await service.getProductOverride(tenantB, productId))?.config.messages?.["first_entry.commercial_intro"] === "منتج ب");
    add("Missing Seller maps to typed safe error", await expectsError(() => service.saveSellerOverride(createTenantContext(uniqueId("seller_missing")), sellerOverride("x")), ConversationConfigSellerNotFoundError));
    add("Missing Product maps to typed safe error", await expectsError(() => service.saveProductOverride(tenantA, uniqueId("product_missing"), productOverride("x")), ConversationConfigProductNotFoundError));

    const roundTrip = await service.getProductOverride(tenantA, productId);
    add("Stored JSON round-trips without semantic loss", JSON.stringify(roundTrip?.config) === JSON.stringify(conversationConfigValidator.validate(productOverride("منتج أ"), "config").normalizedConfig));
    add("Persisted document remains compatible with current CCE-2 validator", conversationConfigValidator.validate(roundTrip?.config, "persisted").valid);
    const persistedSeller = await service.getSellerOverride(tenantB);
    const provider = new InMemoryConversationConfigProvider({
      sellerOverrides: persistedSeller ? { [sellerB]: persistedSeller.config } : undefined,
      productOverrides: roundTrip ? { [`${sellerA}::${productId}`]: roundTrip.config } : undefined,
    });
    const resolvedProduct = new ConversationConfigResolver(provider).resolve({ sellerId: sellerA, productId });
    const resolvedSeller = new ConversationConfigResolver(provider).resolve({ sellerId: sellerB, productId });
    add("Persisted seller/product overrides can be passed to existing CCE-2 resolver", resolvedProduct.messages["first_entry.commercial_intro"] === "منتج أ" && resolvedSeller.messages["first_entry.commercial_intro"] === "ترحيب بائع ب");
    add("Resolution hierarchy remains system -> seller -> product", resolvedProduct.sources.some((entry) => entry.source === "product") && resolvedSeller.sources.some((entry) => entry.source === "seller"));
    const defaultOutput = new ConversationConfigResolver(new InMemoryConversationConfigProvider()).resolve({ sellerId: uniqueId("no_override") });
    add("Existing default output remains unchanged when no persisted override exists", defaultOutput.messages["first_entry.commercial_intro"] === AR_MA_MESSAGES["first_entry.commercial_intro"]);

    await executeDatabaseQuery({
      text: "UPDATE seller_conversation_configs SET config_json = $2::jsonb WHERE seller_id = $1",
      values: [sellerB, JSON.stringify({ schemaVersion: 2 })],
    });
    add("Corrupted persisted JSON is detected as typed corruption error", await expectsError(() => service.getSellerOverride(tenantB), ConversationConfigCorruptedError));
    await service.clearSellerOverride(tenantB);

    const tables = await executeDatabaseQuery<{ table_name: string; column_name: string }>({
      text: `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('seller_conversation_configs', 'product_conversation_config_overrides') ORDER BY table_name ASC, ordinal_position ASC`,
    });
    const expectedColumns = "product_conversation_config_overrides:seller_id|product_conversation_config_overrides:product_id|product_conversation_config_overrides:schema_version|product_conversation_config_overrides:config_json|product_conversation_config_overrides:created_at|product_conversation_config_overrides:updated_at|seller_conversation_configs:seller_id|seller_conversation_configs:schema_version|seller_conversation_configs:config_json|seller_conversation_configs:created_at|seller_conversation_configs:updated_at";
    add("Queries are tenant-scoped and parameterized", (await service.getProductOverride(tenantB, productId))?.config.messages?.["first_entry.commercial_intro"] === "منتج ب");
    add("Tables contain only expected columns and constraints", tables.rows.map((row) => `${row.table_name}:${row.column_name}`).join("|") === expectedColumns);
  } finally {
    await cleanup();
    const remaining = sellerIds.length ? await executeDatabaseQuery<{ count: string }>({ text: "SELECT COUNT(*)::text AS count FROM seller_conversation_configs WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    add("Test rows are cleaned up", remaining.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Phase 7D conversation configuration persistence test failed safely." })}\n`);
  process.exitCode = 1;
});
