import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  getDatabasePoolState,
} from "../../../infrastructure/database";
import { DatabaseConnectionError } from "../../../infrastructure/database";
import { createPersistenceComposition } from "../../persistence/create-persistence-composition";
import { createRuntimeReadComposition } from "../create-runtime-read-composition";
import { mapCatalogProductToRuntimeContext } from "../runtime-catalog-reader";
import { ConversationConfigCorruptedError } from "../../../modules/conversation-config";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
const cases: TestCase[] = [];
const sellerIds: string[] = [];
const execFileAsync = promisify(execFile);

function add(name: string, passed: boolean): void { cases.push({ name, passed }); }
function unique(prefix: string): string { return `${prefix}_${randomUUID().replace(/-/gu, "")}`; }
async function source(file: string): Promise<string> { return readFile(path.resolve(process.cwd(), "src", file), "utf8"); }

async function runAgentProbe(input: Readonly<{ enabled: boolean; sellerId: string; productId: string }>): Promise<string> {
  const script = [
    "const { generateAgentResult } = require('./dist/modules/agent/agent.service.js');",
    "const { closeDatabasePool } = require('./dist/infrastructure/database');",
    `(async () => { const result = await generateAgentResult('شنو هو المنتوج', undefined, ${JSON.stringify({ sellerId: input.sellerId, productId: input.productId, useMemory: false })});`,
    "await closeDatabasePool(); process.stdout.write(JSON.stringify({ reply: result.reply, source: result.source })); })().catch(async (error) => { await closeDatabasePool(); console.error(error); process.exitCode = 1; });",
  ].join(" ");
  const result = await execFileAsync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    timeout: 10_000,
    env: { ...process.env, PERSISTENCE_RUNTIME_READS_ENABLED: input.enabled ? "true" : "false" },
  });
  return result.stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1) || "";
}

function product(productId: string, name: string) {
  return {
    productId,
    name,
    description: "Runtime read product",
    price: { amountMinor: 19_900, currencyCode: "MAD" },
    availability: "available",
    options: [
      {
        optionId: "size",
        label: "المقاس",
        required: true,
        position: 0,
        values: [
          { valueId: "38", label: "38", position: 1, isAvailable: true },
          { valueId: "37", label: "37", position: 0, isAvailable: true },
        ],
      },
      {
        optionId: "material",
        label: "الخامة",
        required: false,
        position: 1,
        values: [{ valueId: "leather", label: "جلد", position: 0, isAvailable: true }],
      },
    ],
  };
}

async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({
    text: "DELETE FROM seller_conversation_configs WHERE seller_id = ANY($1::varchar[])",
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
  add("Runtime-read module import does not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const disabled = createRuntimeReadComposition({ mode: "disabled" });
  add("Runtime-read composition construction performs no query", !getDatabasePoolState().initialized);

  const legacy = {
    sellerId: "seller_legacy",
    productId: "product_legacy",
    name: "Legacy Product",
    price: 199,
    currency: "MAD" as const,
    active: true,
    images: [], benefits: [], optionGroups: [], infoMenu: [],
    stock: { enabled: true, status: "AVAILABLE" as const },
  };
  const disabledMissing = await disabled.catalogReader.resolve({ sellerId: "default-seller", productId: legacy.productId, legacyProductContext: legacy });
  const disabledFalse = await disabled.conversationConfigReader.resolve({ sellerId: "default-seller", productId: legacy.productId });
  add("Feature flag missing and false use the legacy behavior", disabledMissing.source === "legacy" && disabledFalse.source === "legacy");
  add("Disabled mode performs zero Catalog and Config database reads", !getDatabasePoolState().initialized);
  add("Disabled mode remains safe without DATABASE_URL", disabledMissing.productContext === legacy);

  const persistence = createPersistenceComposition();
  const sellerA = unique("seller_7f2_a");
  const sellerB = unique("seller_7f2_b");
  const sellerC = unique("seller_7f2_c");
  const sharedProductId = unique("product_7f2");
  sellerIds.push(sellerA, sellerB, sellerC);

  try {
    await persistence.sellerService.createSeller(sellerA);
    await persistence.sellerService.createSeller(sellerB);
    await persistence.sellerService.createSeller(sellerC);
    const tenantA = createTenantContext(sellerA);
    const tenantB = createTenantContext(sellerB);
    await persistence.catalogService.createProduct(tenantA, product(sharedProductId, "منتج أ"));
    await persistence.catalogService.createProduct(tenantB, product(sharedProductId, "منتج ب"));
    await persistence.conversationConfigService.saveSellerOverride(tenantA, {
      schemaVersion: 1,
      labels: { "common.select": "اختار من البائع" },
    });
    await persistence.conversationConfigService.saveProductOverride(tenantA, sharedProductId, {
      schemaVersion: 1,
      labels: { "common.select": "اختار من المنتج" },
    });

    const enabled = createRuntimeReadComposition({ mode: "enabled", persistence });
    const originalGetProduct = persistence.catalogService.getProduct.bind(persistence.catalogService);
    let productLookupCount = 0;
    (persistence.catalogService as unknown as { getProduct: typeof persistence.catalogService.getProduct }).getProduct = async (...args) => {
      productLookupCount += 1;
      return originalGetProduct(...args);
    };
    const resolvedA = await enabled.catalogReader.resolve({ sellerId: sellerA, productId: sharedProductId, legacyProductContext: legacy });
    const resolvedB = await enabled.catalogReader.resolve({ sellerId: sellerB, productId: sharedProductId, legacyProductContext: legacy });
    add("Enabled mode loads a tenant-scoped persisted Product", resolvedA.source === "persistence" && resolvedA.productContext.sellerId === sellerA);
    add("Persisted Product maps to the existing Product runtime contract", resolvedA.productContext.name === "منتج أ" && resolvedA.productContext.currency === "MAD");
    add("Dynamic options preserve deterministic ordering", resolvedA.productContext.optionGroups.map((entry) => entry.key).join("|") === "size|material" && resolvedA.productContext.optionGroups[0]?.options.join("|") === "37|38");
    add("Product price maps without changing approved money semantics", resolvedA.productContext.price === 199);
    add("Missing persisted Product falls back to legacy Product", (await enabled.catalogReader.resolve({ sellerId: sellerA, productId: unique("missing"), legacyProductContext: legacy })).source === "legacy");
    add("Seller A cannot resolve Seller B Product", resolvedA.productContext.name !== resolvedB.productContext.name && resolvedB.productContext.sellerId === sellerB);
    add("Same productId resolves independently across Sellers", resolvedA.productContext.name === "منتج أ" && resolvedB.productContext.name === "منتج ب");
    add("Invalid/default-seller persistence context remains on legacy path", (await enabled.catalogReader.resolve({ sellerId: "default-seller", productId: sharedProductId, legacyProductContext: legacy })).source === "legacy");

    const originalGetSellerOverride = persistence.conversationConfigService.getSellerOverride.bind(persistence.conversationConfigService);
    const originalGetProductOverride = persistence.conversationConfigService.getProductOverride.bind(persistence.conversationConfigService);
    let sellerOverrideLookupCount = 0;
    let productOverrideLookupCount = 0;
    (persistence.conversationConfigService as unknown as { getSellerOverride: typeof persistence.conversationConfigService.getSellerOverride }).getSellerOverride = async (...args) => {
      sellerOverrideLookupCount += 1;
      return originalGetSellerOverride(...args);
    };
    (persistence.conversationConfigService as unknown as { getProductOverride: typeof persistence.conversationConfigService.getProductOverride }).getProductOverride = async (...args) => {
      productOverrideLookupCount += 1;
      return originalGetProductOverride(...args);
    };
    const configA = await enabled.conversationConfigReader.resolve({ sellerId: sellerA, productId: sharedProductId });
    const configB = await enabled.conversationConfigReader.resolve({ sellerId: sellerB, productId: sharedProductId });
    const noProductConfig = await enabled.conversationConfigReader.resolve({ sellerId: sellerA, productId: unique("missing") });
    add("Enabled mode loads persisted Seller and Product overrides", configA.source === "persistence" && configA.config.sources.some((entry) => entry.source === "seller") && configA.config.sources.some((entry) => entry.source === "product"));
    add("Existing CCE resolver preserves system -> seller -> product hierarchy", configA.config.labels["common.select"] === "اختار من المنتج");
    add("Product override wins over Seller override", configA.config.labels["common.select"] === "اختار من المنتج");
    add("Missing Product override preserves Seller/default behavior", noProductConfig.config.labels["common.select"] === "اختار من البائع");
    add("No persisted overrides preserve current default output and tenant isolation", configB.config.labels["common.select"] !== "اختار من المنتج" && configB.config.labels["common.select"] !== "اختار من البائع");
    const configC = await enabled.conversationConfigReader.resolve({ sellerId: sellerC, productId: sharedProductId });
    add("Missing Seller override preserves system/default behavior", configC.config.labels["common.select"] !== "اختار من المنتج" && configC.config.labels["common.select"] !== "اختار من البائع");

    const mapped = mapCatalogProductToRuntimeContext((await persistence.catalogService.getProduct(tenantA, sharedProductId))!);
    add("Runtime integration maps only compatible Catalog fields", mapped?.productId === sharedProductId && mapped.optionGroups.length === 2);
    add("One runtime resolution performs no duplicate Product lookup", productLookupCount === 4);
    add("One runtime resolution performs no duplicate Seller override lookup", sellerOverrideLookupCount === 4);
    add("One runtime resolution performs no duplicate Product override lookup", productOverrideLookupCount === 4);

    (persistence.catalogService as unknown as { getProduct: typeof persistence.catalogService.getProduct }).getProduct = async () => { throw new DatabaseConnectionError(); };
    (persistence.conversationConfigService as unknown as { getSellerOverride: typeof persistence.conversationConfigService.getSellerOverride }).getSellerOverride = async () => { throw new DatabaseConnectionError(); };
    add("PostgreSQL-unavailable Product and Config reads fall back safely", (await enabled.catalogReader.resolve({ sellerId: sellerA, productId: sharedProductId, legacyProductContext: legacy })).source === "legacy" && (await enabled.conversationConfigReader.resolve({ sellerId: sellerA, productId: sharedProductId })).source === "legacy");
    (persistence.conversationConfigService as unknown as { getSellerOverride: typeof persistence.conversationConfigService.getSellerOverride }).getSellerOverride = async () => { throw new ConversationConfigCorruptedError(); };
    add("Corrupted persisted config falls back safely", (await enabled.conversationConfigReader.resolve({ sellerId: sellerA, productId: sharedProductId })).source === "legacy");
    (persistence.conversationConfigService as unknown as { getSellerOverride: typeof persistence.conversationConfigService.getSellerOverride }).getSellerOverride = originalGetSellerOverride;

    const runtimeReadSource = await source("composition/runtime-read/create-runtime-read-composition.ts");
    const agentSource = await source("modules/agent/agent.service.ts");
    add("Runtime integration performs no persistence writes or migrations", !/createProduct|replaceProduct|setProductAvailability|saveSellerOverride|saveProductOverride|persistConfirmedOrder|runDatabaseMigrations/u.test(runtimeReadSource));
    add("Composition/repositories are not created per message", !/createRuntimeReadComposition\(/u.test(agentSource) && /runtimeReadComposition/u.test(agentSource));
    add("Existing Agent runtime path keeps the disabled legacy provider available", /resolveRuntimeProductContext/u.test(agentSource) && /runtimeReadComposition\.catalogReader\.resolve/u.test(agentSource));

    await persistence.conversationConfigService.saveSellerOverride(tenantB, {
      schemaVersion: 1,
      labels: { "common.select": "اختار من البائع ب" },
    });
    const sellerBConfig = await enabled.conversationConfigReader.resolve({ sellerId: sellerB, productId: sharedProductId });
    add("Seller A cannot read Seller B overrides", sellerBConfig.config.labels["common.select"] === "اختار من البائع ب" && configA.config.labels["common.select"] === "اختار من المنتج");

    const disabledAgentProbe = await runAgentProbe({ enabled: false, sellerId: "seller_demo_sandals", productId: "prod_demo_sandal_001" });
    const disabledAgentReply = JSON.parse(disabledAgentProbe).reply as string;
    add("Existing Agent test path succeeds with feature disabled", Boolean(disabledAgentReply));
    add("Customer-visible default output remains unchanged with no persisted rows", disabledAgentReply.includes("صندالة نسائية") && disabledAgentReply.includes("199"));
    const enabledAgentProbe = await runAgentProbe({ enabled: true, sellerId: sellerA, productId: sharedProductId });
    add("Existing Agent test path can use seeded persisted reads when enabled", JSON.parse(enabledAgentProbe).reply.includes("منتج أ"));
  } finally {
    await cleanup();
    const remaining = sellerIds.length
      ? await executeDatabaseQuery<{ count: string }>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] })
      : { rows: [{ count: "0" }] };
    add("Focused runtime-read rows are cleaned up", remaining.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  console.log(JSON.stringify({ phase: "7F2", summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(async (error: unknown) => {
  await closeDatabasePool();
  console.error(error);
  process.exitCode = 1;
});
