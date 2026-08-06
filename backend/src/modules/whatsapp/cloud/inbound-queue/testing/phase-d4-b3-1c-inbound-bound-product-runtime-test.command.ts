import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
  runDatabaseMigrations,
} from "../../../../../infrastructure/database";
import { SellerCommerceRuntimeProjectionReader } from "../../../../../composition/runtime-read/seller-commerce-runtime-projection";
import { CatalogService, PostgreSqlCatalogRepository } from "../../../../catalog";
import { ConversationConfigService, PostgreSqlConversationConfigRepository } from "../../../../conversation-config";
import { SellerService } from "../../../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../../../seller-workspace-profile";
import { SellerCommerceConfigRepository, SellerCommerceConfigRuntimeReader } from "../../../../seller-commerce-config";
import {
  PostgreSqlWhatsAppConnectionRepository,
  WhatsAppConnectionProductBindingService,
  type WhatsAppConnection,
} from "../../../../whatsapp-connection";
import { __phase11kInboundConnectionScopedTesting } from "../whatsapp-inbound-worker.service";
import type { WhatsAppInboundJobData } from "../whatsapp-inbound-job.types";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
const cases: TestCase[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void { cases.push({ name, passed }); }
function id(prefix: string): string { return `${prefix}_${randomUUID().replace(/-/gu, "")}`; }
function commerceConfig(sellerId: string) {
  return {
    configVersion: 1,
    payment: { method: "COD", enabled: true },
    delivery: { enabled: true, availability: "all_cities", pricing: { mode: "ALL_FREE", currency: "MAD" } },
    requiredCustomerFields: [{ key: "fullName", label: "Name", required: true, enabled: true }],
    orderBehavior: { multiItemOrderFlow: { enabled: true, runtimeMode: "guarded", allowedSellerIds: [sellerId] } },
    receipt: { enabled: true, sendAfterConfirmation: true },
  };
}
function product(productId: string, name: string, priceAmountMinor: number, availability: "available" | "unavailable" = "available") {
  return {
    productId, name, description: `${name} description`, price: { amountMinor: priceAmountMinor, currencyCode: "MAD" }, availability,
    options: [{ optionId: "color", label: "Color", required: true, position: 0, values: [
      { valueId: `${productId}_black`, label: "Black", position: 0, isAvailable: true },
      { valueId: `${productId}_pink`, label: "Pink", position: 1, isAvailable: false },
    ] }], images: [], aliases: [`alias_${productId}`], offers: [],
  };
}
async function createActiveConnection(input: { sellerId: string; connectionId: string; phoneNumberId: string; productId: string }, connections: PostgreSqlWhatsAppConnectionRepository, binding: WhatsAppConnectionProductBindingService): Promise<void> {
  const tenant = createTenantContext(input.sellerId);
  await connections.createCandidate(tenant, { connectionId: input.connectionId });
  await connections.persistVerifiedMetadata(tenant, input.connectionId, {
    metaBusinessId: id("business"), wabaId: id("waba"), phoneNumberId: input.phoneNumberId, displayPhoneNumber: "+212600000001", verifiedName: "Runtime Store",
  });
  await binding.setBoundProductId(tenant, input.connectionId, input.productId);
  await connections.updateLifecycleStatus(tenant, input.connectionId, "ACTIVE");
}
async function cleanup(): Promise<void> {
  if (!sellerIds.length) return;
  await executeDatabaseQuery({ text: "DELETE FROM whatsapp_connections WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM seller_conversation_configs WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM seller_commerce_configs WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM seller_workspace_profiles WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] });
}

async function main(): Promise<void> {
  await closeDatabasePool();
  const sellers = new SellerService(new PostgreSqlSellerRepository());
  const catalog = new CatalogService(new PostgreSqlCatalogRepository());
  const conversations = new ConversationConfigService(new PostgreSqlConversationConfigRepository());
  const profiles = new PostgreSqlSellerWorkspaceProfileRepository();
  const commerce = new SellerCommerceConfigRepository();
  const connections = new PostgreSqlWhatsAppConnectionRepository();
  const binding = new WhatsAppConnectionProductBindingService(connections, catalog);
  const projection = new SellerCommerceRuntimeProjectionReader({ commerceConfigReader: new SellerCommerceConfigRuntimeReader(commerce), catalogService: catalog, conversationConfigService: conversations, workspaceProfileRepository: profiles, whatsappConnectionRepository: connections });
  const sellerA = id("seller_d4_b3_1c_a");
  const sellerB = id("seller_d4_b3_1c_b");
  sellerIds.push(sellerA, sellerB);
  const tenantA = createTenantContext(sellerA);
  const tenantB = createTenantContext(sellerB);
  const productA = id("product_a");
  const productA2 = id("product_a2");
  const unavailableA = id("product_unavailable");
  const sharedId = id("shared_product");
  const connectionA = id("connection_a");
  const connectionB = id("connection_b");
  const phoneA = "711111111111111";
  const phoneB = "722222222222222";

  try {
    const migration = await runDatabaseMigrations();
    add("PostgreSQL migrations are current before inbound acceptance", migration.pending.length === 0);
    for (const [sellerId, tenant] of [[sellerA, tenantA], [sellerB, tenantB]] as const) {
      await sellers.createSeller(sellerId);
      await profiles.createProfile({ sellerId, displayName: `Store ${sellerId}` });
      await commerce.save(tenant, commerceConfig(sellerId));
      await conversations.saveSellerOverride(tenant, { schemaVersion: 1 });
    }
    await catalog.createProduct(tenantA, product(productA, "Bound Product A", 19_900));
    await catalog.createProduct(tenantA, product(productA2, "Bound Product A2", 23_500));
    await catalog.createProduct(tenantA, product(unavailableA, "Unavailable Product", 18_000, "unavailable"));
    await catalog.createProduct(tenantA, product(sharedId, "Seller A Shared", 21_000));
    await catalog.createProduct(tenantB, product(sharedId, "Seller B Shared", 31_000));
    await createActiveConnection({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA, productId: productA }, connections, binding);
    await createActiveConnection({ sellerId: sellerB, connectionId: connectionB, phoneNumberId: phoneB, productId: sharedId }, connections, binding);

    const currentA = await projection.resolve({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA, productId: productA2 });
    const currentB = await projection.resolve({ sellerId: sellerB, connectionId: connectionB, phoneNumberId: phoneB, productId: productA });
    add("inbound phone connection resolves its bound tenant product rather than caller product", currentA.status === "READY" && currentA.productContext.productId === productA && currentB.status === "READY" && currentB.productContext.productId === sharedId && currentB.productContext.name === "Seller B Shared");
    add("runtime product projection preserves product identity, currency, minor units, ordered option IDs, and hides image keys", currentA.status === "READY" && currentA.productContext.priceAmountMinor === 19_900 && currentA.productContext.price === 199 && currentA.productContext.currency === "MAD" && currentA.productContext.optionGroups[0]?.valueConfigurations?.[0]?.key === `${productA}_black` && currentA.productContext.images.length === 0);

    const [agentSource, sessionSource, cloudSource] = await Promise.all([
      readFile("src/modules/agent/agent.service.ts", "utf8"),
      readFile("src/modules/agent/session/conversation-session.service.ts", "utf8"),
      readFile("src/modules/whatsapp/cloud/whatsapp-cloud.service.ts", "utf8"),
    ]);
    add("Agent handoff supplies only trusted connection identity and derives its product from the persisted runtime projection", cloudSource.includes("connectionId: connectionRuntime?.connectionId") && agentSource.includes("connectionId: options?.connectionId") && agentSource.includes("? runtimeProductContext.productId"));
    add("stale or foreign-compatible session product reference is corrected from persisted binding", sessionSource.includes("session.productId = productContext.productId"));

    const job: WhatsAppInboundJobData = { schemaVersion: 1, sellerId: sellerA, conversationKey: `${sellerA}:212600000002`, customerPhone: "212600000002", phoneNumberId: phoneA, messageId: id("message"), sourceType: "button_reply", text: "product_a2", buttonReplyId: productA2 };
    let resolverInput: { sellerId: string; phoneNumberId: string } | undefined;
    const scoped = await __phase11kInboundConnectionScopedTesting.resolveConnectionScopedRuntime(job, { resolveForTrustedInbound: async (input) => { resolverInput = input; return { sellerId: input.sellerId, connectionId: connectionA, phoneNumberId: input.phoneNumberId, accessToken: "memory_only_token", tokenSource: "encrypted_connection_token" as const }; } });
    add("queue job preserves only server-owned routing identifiers and worker resolves exact inbound phone connection", resolverInput?.sellerId === sellerA && resolverInput?.phoneNumberId === phoneA && !JSON.stringify(job).includes("token") && !JSON.stringify(job).includes("productId") && scoped.connectionId === connectionA);

    await binding.setBoundProductId(tenantA, connectionA, productA2);
    const afterChange = await projection.resolve({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA });
    add("binding change affects a later inbound projection without session or caller selection", afterChange.status === "READY" && afterChange.productContext.productId === productA2 && afterChange.productContext.priceAmountMinor === 23_500);
    await binding.setBoundProductId(tenantA, connectionA, null);
    const unbound = await projection.resolve({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA });
    add("cleared binding fails closed without default or first Catalog product", unbound.status !== "READY" && unbound.readinessReason === "WHATSAPP_PRODUCT_BINDING_REQUIRED");

    await binding.setBoundProductId(tenantA, connectionA, unavailableA);
    const unavailable = await projection.resolve({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA });
    add("unavailable bound product remains bound but cannot enter commerce runtime", unavailable.status !== "READY" && unavailable.readinessReason === "WHATSAPP_PRODUCT_UNAVAILABLE");
    await binding.setBoundProductId(tenantA, connectionA, productA2);
    await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = $1 AND product_id = $2", values: [sellerA, productA2] });
    const deleted = await projection.resolve({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA });
    const connectionAfterDelete = await connections.findByConnectionId(tenantA, connectionA);
    add("deleted bound product clears only binding and later inbound resolution fails closed", connectionAfterDelete?.boundProductId === null && connectionAfterDelete.status === "ACTIVE" && connectionAfterDelete.sellerId === sellerA && deleted.status !== "READY" && deleted.readinessReason === "WHATSAPP_PRODUCT_BINDING_REQUIRED");

    await binding.setBoundProductId(tenantA, connectionA, productA);
    await connections.updateLifecycleStatus(tenantA, connectionA, "DISCONNECTED");
    const disconnected = await projection.resolve({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA });
    add("disconnected exact inbound connection fails closed even with a valid binding", disconnected.status !== "READY" && disconnected.readinessReason === "WHATSAPP_CONNECTION_INVALID");
    await connections.updateLifecycleStatus(tenantA, connectionA, "ACTIVE");
    await conversations.clearSellerOverride(tenantA);
    const missingConversation = await projection.resolve({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA });
    await conversations.saveSellerOverride(tenantA, { schemaVersion: 1 });
    await executeDatabaseQuery({ text: "DELETE FROM seller_commerce_configs WHERE seller_id = $1", values: [sellerA] });
    const missingCommerce = await projection.resolve({ sellerId: sellerA, connectionId: connectionA, phoneNumberId: phoneA });
    add("missing conversation and commerce configuration fail closed", missingConversation.status !== "READY" && missingConversation.readinessReason === "SELLER_CONVERSATION_CONFIG_REQUIRED" && missingCommerce.status !== "READY" && missingCommerce.readinessReason === "SELLER_COMMERCE_CONFIG_REQUIRED");

    // The existing database policy permits one ACTIVE connection per seller.
    // This focused seam proves the new exact selector does not use that seller-wide lookup,
    // so independently resolved connections remain distinct when the lifecycle permits them.
    const fakeA: WhatsAppConnection = { ...(connectionAfterDelete as WhatsAppConnection), connectionId: "fake_inbound_a", phoneNumberId: "733333333333333", boundProductId: productA, status: "ACTIVE", connectedAt: new Date() };
    const fakeB: WhatsAppConnection = { ...fakeA, connectionId: "fake_inbound_b", phoneNumberId: "744444444444444", boundProductId: sharedId };
    const fakeShared: WhatsAppConnection = { ...fakeA, connectionId: "fake_inbound_shared", phoneNumberId: "755555555555555" };
    const exactRepository = { ...connections, findByConnectionId: async (_tenant: unknown, connectionId: string) => connectionId === fakeA.connectionId ? fakeA : connectionId === fakeB.connectionId ? fakeB : connectionId === fakeShared.connectionId ? fakeShared : null, findActiveBySeller: async () => { throw new Error("seller_wide_lookup_forbidden"); } };
    const exactProjection = new SellerCommerceRuntimeProjectionReader({ commerceConfigReader: new SellerCommerceConfigRuntimeReader(commerce), catalogService: catalog, conversationConfigService: conversations, workspaceProfileRepository: profiles, whatsappConnectionRepository: exactRepository as never });
    await commerce.save(tenantA, commerceConfig(sellerA));
    const exactA = await exactProjection.resolve({ sellerId: sellerA, connectionId: fakeA.connectionId, phoneNumberId: fakeA.phoneNumberId });
    const exactB = await exactProjection.resolve({ sellerId: sellerA, connectionId: fakeB.connectionId, phoneNumberId: fakeB.phoneNumberId });
    const exactShared = await exactProjection.resolve({ sellerId: sellerA, connectionId: fakeShared.connectionId, phoneNumberId: fakeShared.phoneNumberId });
    add("multiple same-seller inbound connection identities select independently without seller-wide active lookup", exactA.status === "READY" && exactA.productContext.productId === productA && exactB.status === "READY" && exactB.productContext.productId === sharedId);
    add("multiple connections may share one bound product without changing either connection authority", exactA.status === "READY" && exactShared.status === "READY" && exactA.productContext.productId === exactShared.productContext.productId);
  } finally {
    await cleanup();
    await closeDatabasePool();
  }
  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ phase: "D4-B3.1c", summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases }, null, 2)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => { await closeDatabasePool(); process.stderr.write(`${JSON.stringify({ phase: "D4-B3.1c", ok: false, message: "inbound connection-bound product runtime acceptance failed safely" })}\n`); process.exitCode = 1; });
