import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  DatabaseQueryError,
  executeDatabaseQuery,
  getDatabaseMigrationStatus,
  runDatabaseMigrations,
} from "../../../infrastructure/database";
import { SellerCommerceRuntimeProjectionReader } from "../../../composition/runtime-read/seller-commerce-runtime-projection";
import { CatalogService, PostgreSqlCatalogRepository } from "../../catalog";
import { ConversationConfigService, PostgreSqlConversationConfigRepository } from "../../conversation-config";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import { SellerCommerceConfigRepository, SellerCommerceConfigRuntimeReader } from "../../seller-commerce-config";
import {
  PostgreSqlWhatsAppConnectionRepository,
  WhatsAppConnectionProductBindingService,
} from "../index";

dotenv.config();

type TestCase = Readonly<{ name: string; passed: boolean }>;
type ConnectionEvidence = Readonly<{
  seller_id: string;
  connection_id: string;
  bound_product_id: string | null;
  status: string;
  phone_number_id: string | null;
  meta_business_id: string | null;
  waba_id: string | null;
  encrypted_access_token: string | null;
  token_key_version: string | null;
  token_fingerprint: string | null;
  row_without_binding: Record<string, unknown>;
}>;

const cases: TestCase[] = [];
const sellerIds: string[] = [];

function add(name: string, passed: boolean): void { cases.push({ name, passed }); }
function unique(prefix: string): string { return `${prefix}_${randomUUID().replace(/-/gu, "")}`; }
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
function product(productId: string, availability: "available" | "unavailable") {
  return {
    productId,
    name: `Product ${productId}`,
    description: "Connection binding acceptance product",
    price: { amountMinor: 19_900, currencyCode: "MAD" },
    availability,
    options: [], images: [], aliases: [], offers: [],
  };
}
async function captureError(callback: () => Promise<unknown>): Promise<Error | undefined> {
  try { await callback(); return undefined; } catch (error) { return error instanceof Error ? error : new Error("unknown_error"); }
}
function errorIsSafe(error: Error | undefined, forbidden: readonly string[]): boolean {
  if (!error) return false;
  const exposed = `${error.name}|${error.message}|${JSON.stringify(error)}`.toLowerCase();
  return forbidden.every((value) => !exposed.includes(value.toLowerCase()));
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
  const readiness = new SellerCommerceRuntimeProjectionReader({
    commerceConfigReader: new SellerCommerceConfigRuntimeReader(commerce),
    catalogService: catalog,
    conversationConfigService: conversations,
    workspaceProfileRepository: profiles,
    whatsappConnectionRepository: connections,
  });

  const sellerA = unique("seller_d4_b3_1a_a");
  const sellerB = unique("seller_d4_b3_1a_b");
  const sellerC = unique("seller_d4_b3_1a_c");
  const tenantA = createTenantContext(sellerA);
  const tenantB = createTenantContext(sellerB);
  const tenantC = createTenantContext(sellerC);
  sellerIds.push(sellerA, sellerB, sellerC);
  const availableA = unique("available");
  const unavailableA = unique("unavailable");
  const deletedProductId = unique("deleted");
  const foreignOnlyProductId = unique("foreign_only");
  const legacyConnectionId = unique("legacy_connection");

  try {
    const migration = await runDatabaseMigrations();
    const migrationStatus = await getDatabaseMigrationStatus();
    add("migration 0017 is applied before PostgreSQL acceptance assertions", migration.applied.includes("0017") || migrationStatus.applied.includes("0017"));

    for (const [sellerId, tenant] of [[sellerA, tenantA], [sellerB, tenantB], [sellerC, tenantC]] as const) {
      await sellers.createSeller(sellerId);
      await profiles.createProfile({ sellerId, displayName: `Store ${sellerId}` });
      await commerce.save(tenant, commerceConfig(sellerId));
      await conversations.saveSellerOverride(tenant, { schemaVersion: 1 });
    }
    await catalog.createProduct(tenantA, product(availableA, "available"));
    await catalog.createProduct(tenantA, product(unavailableA, "unavailable"));
    await catalog.createProduct(tenantA, product(deletedProductId, "available"));
    await catalog.createProduct(tenantB, product(foreignOnlyProductId, "available"));
    await catalog.createProduct(tenantB, product(deletedProductId, "available"));
    await catalog.createProduct(tenantC, product(unique("available_c"), "available"));

    // This row deliberately omits the new column, as a pre-binding connection row would.
    await executeDatabaseQuery({
      text: "INSERT INTO whatsapp_connections (connection_id, seller_id, provider, status) VALUES ($1, $2, 'META_WHATSAPP_CLOUD_API', 'PENDING')",
      values: [legacyConnectionId, sellerA],
    });
    const migratedConnection = await connections.findByConnectionId(tenantA, legacyConnectionId);
    add("existing migrated connections read boundProductId as null", migratedConnection?.boundProductId === null);

    await connections.persistVerifiedMetadata(tenantA, legacyConnectionId, {
      metaBusinessId: unique("business"), wabaId: unique("waba"), phoneNumberId: unique("phone"), displayPhoneNumber: "+212600000001", verifiedName: "Binding Store",
    });
    await connections.persistAccessTokenCredential(tenantA, legacyConnectionId, {
      encryptedAccessToken: "encrypted_access_token_metadata", tokenKeyVersion: "v1", tokenFingerprint: "token_fingerprint_metadata",
    });
    await connections.updateLifecycleStatus(tenantA, legacyConnectionId, "ACTIVE");

    const unbound = await readiness.resolve({ sellerId: sellerA, productId: unavailableA });
    add("unbound operational connection is commerce-not-ready", unbound.status !== "READY" && unbound.readinessReason === "WHATSAPP_PRODUCT_BINDING_REQUIRED");

    const availableBound = await binding.setBoundProductId(tenantA, legacyConnectionId, availableA);
    const availableReady = await readiness.resolve({ sellerId: sellerA, productId: unavailableA });
    add("available same-tenant product binds and is the sole readiness product authority", availableBound.boundProductId === availableA && availableReady.status === "READY" && availableReady.productContext.productId === availableA);

    const unavailableBound = await binding.setBoundProductId(tenantA, legacyConnectionId, unavailableA);
    const unavailableReady = await readiness.resolve({ sellerId: sellerA, productId: availableA });
    add("unavailable product binding persists while commerce readiness fails", unavailableBound.boundProductId === unavailableA && unavailableReady.status !== "READY" && unavailableReady.readinessReason === "WHATSAPP_PRODUCT_UNAVAILABLE");

    const changed = await binding.setBoundProductId(tenantA, legacyConnectionId, availableA);
    const cleared = await binding.setBoundProductId(tenantA, legacyConnectionId, null);
    const clearedAgain = await binding.setBoundProductId(tenantA, legacyConnectionId, null);
    const rebound = await binding.setBoundProductId(tenantA, legacyConnectionId, availableA);
    add("binding change, clear, and repeated bind/clear are durable and idempotent", changed.boundProductId === availableA && cleared.boundProductId === null && clearedAgain.boundProductId === null && rebound.boundProductId === availableA);

    const missingProductError = await captureError(() => binding.setBoundProductId(tenantA, legacyConnectionId, unique("missing")));
    const foreignProductError = await captureError(() => binding.setBoundProductId(tenantA, legacyConnectionId, foreignOnlyProductId));
    const afterRejectedProducts = await connections.findByConnectionId(tenantA, legacyConnectionId);
    add("missing and foreign products are rejected without replacing the old binding", Boolean(missingProductError) && Boolean(foreignProductError) && afterRejectedProducts?.boundProductId === availableA);

    const connectionB = await connections.createCandidate(tenantB);
    const missingConnectionError = await captureError(() => binding.setBoundProductId(tenantA, unique("missing_connection"), availableA));
    const foreignConnectionError = await captureError(() => binding.setBoundProductId(tenantA, connectionB.connectionId, availableA));
    add("missing and foreign connections are rejected", Boolean(missingConnectionError) && Boolean(foreignConnectionError));
    add("binding errors expose no SQL constraints, seller ids, credentials, tokens, or stack traces", [missingProductError, foreignProductError, missingConnectionError, foreignConnectionError].every((error) => errorIsSafe(error, ["constraint", sellerA, sellerB, "credential", "token", "stack", "sql"])));

    const connectionA2 = await connections.createCandidate(tenantA);
    await binding.setBoundProductId(tenantA, connectionA2.connectionId, availableA);
    await binding.setBoundProductId(tenantA, legacyConnectionId, deletedProductId);
    const connectionA2AfterChange = await connections.findByConnectionId(tenantA, connectionA2.connectionId);
    add("two connections may share a product and changing one does not affect the other", connectionA2AfterChange?.boundProductId === availableA && (await connections.findByConnectionId(tenantA, legacyConnectionId))?.boundProductId === deletedProductId);

    const foreignFkError = await captureError(() => executeDatabaseQuery({
      text: "UPDATE whatsapp_connections SET bound_product_id = $3 WHERE seller_id = $1 AND connection_id = $2",
      values: [sellerA, legacyConnectionId, foreignOnlyProductId],
    }));
    const foreignFkCode = foreignFkError instanceof DatabaseQueryError && typeof foreignFkError.cause === "object" && foreignFkError.cause !== null && "code" in foreignFkError.cause
      ? foreignFkError.cause.code : undefined;
    add("database composite FK rejects a cross-tenant binding", foreignFkCode === "23503" && (await connections.findByConnectionId(tenantA, legacyConnectionId))?.boundProductId === deletedProductId);

    await binding.setBoundProductId(tenantB, connectionB.connectionId, deletedProductId);
    await binding.setBoundProductId(tenantA, legacyConnectionId, deletedProductId);
    const beforeDelete = (await executeDatabaseQuery<ConnectionEvidence>({
      text: "SELECT seller_id, connection_id, bound_product_id, status, phone_number_id, meta_business_id, waba_id, encrypted_access_token, token_key_version, token_fingerprint, to_jsonb(whatsapp_connections) - 'bound_product_id' AS row_without_binding FROM whatsapp_connections WHERE seller_id = $1 AND connection_id = $2",
      values: [sellerA, legacyConnectionId],
    })).rows[0];
    await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = $1 AND product_id = $2", values: [sellerA, deletedProductId] });
    const afterDelete = (await executeDatabaseQuery<ConnectionEvidence>({
      text: "SELECT seller_id, connection_id, bound_product_id, status, phone_number_id, meta_business_id, waba_id, encrypted_access_token, token_key_version, token_fingerprint, to_jsonb(whatsapp_connections) - 'bound_product_id' AS row_without_binding FROM whatsapp_connections WHERE seller_id = $1 AND connection_id = $2",
      values: [sellerA, legacyConnectionId],
    })).rows[0];
    const otherSellerAfterDelete = await connections.findByConnectionId(tenantB, connectionB.connectionId);
    const deletedReadiness = await readiness.resolve({ sellerId: sellerA });
    add("product deletion clears only bound_product_id and preserves connection identity, status, and credential metadata", Boolean(beforeDelete) && Boolean(afterDelete) && beforeDelete?.bound_product_id === deletedProductId && afterDelete?.bound_product_id === null && JSON.stringify(beforeDelete.row_without_binding) === JSON.stringify(afterDelete.row_without_binding) && beforeDelete.seller_id === afterDelete.seller_id && beforeDelete.connection_id === afterDelete.connection_id && beforeDelete.status === afterDelete.status && beforeDelete.phone_number_id === afterDelete.phone_number_id && beforeDelete.meta_business_id === afterDelete.meta_business_id && beforeDelete.waba_id === afterDelete.waba_id && beforeDelete.encrypted_access_token === afterDelete.encrypted_access_token && beforeDelete.token_key_version === afterDelete.token_key_version && beforeDelete.token_fingerprint === afterDelete.token_fingerprint);
    add("product deletion leaves another seller using the same product id unaffected and makes the deleted binding unbound", otherSellerAfterDelete?.boundProductId === deletedProductId && deletedReadiness.status !== "READY" && deletedReadiness.readinessReason === "WHATSAPP_PRODUCT_BINDING_REQUIRED");

    await binding.setBoundProductId(tenantA, legacyConnectionId, availableA);
    await connections.updateLifecycleStatus(tenantA, legacyConnectionId, "DISCONNECTED");
    const disconnected = await readiness.resolve({ sellerId: sellerA });
    await connections.updateLifecycleStatus(tenantA, legacyConnectionId, "ACTIVE");
    add("disconnected connection remains not ready despite a valid bound product", disconnected.status !== "READY" && disconnected.readinessReason === "WHATSAPP_CONNECTION_REQUIRED");

    const invalidProductC = unique("available_c");
    await catalog.createProduct(tenantC, product(invalidProductC, "available"));
    const invalidConnection = await connections.createCandidate(tenantC);
    await binding.setBoundProductId(tenantC, invalidConnection.connectionId, invalidProductC);
    await connections.updateLifecycleStatus(tenantC, invalidConnection.connectionId, "ACTIVE");
    const invalid = await readiness.resolve({ sellerId: sellerC });
    add("invalid active connection remains not ready despite a valid bound product", invalid.status !== "READY" && invalid.readinessReason === "WHATSAPP_CONNECTION_INVALID");

    await conversations.clearSellerOverride(tenantA);
    const missingConversation = await readiness.resolve({ sellerId: sellerA });
    await conversations.saveSellerOverride(tenantA, { schemaVersion: 1 });
    await executeDatabaseQuery({ text: "DELETE FROM seller_commerce_configs WHERE seller_id = $1", values: [sellerA] });
    const missingCommerce = await readiness.resolve({ sellerId: sellerA });
    add("missing persisted conversation or commerce configuration remains not ready", missingConversation.status !== "READY" && missingConversation.readinessReason === "SELLER_CONVERSATION_CONFIG_REQUIRED" && missingCommerce.status !== "READY" && missingCommerce.readinessReason === "SELLER_COMMERCE_CONFIG_REQUIRED");
  } finally {
    await cleanup();
    const remaining = sellerIds.length ? await executeDatabaseQuery<{ count: string }>({ text: "SELECT COUNT(*)::text AS count FROM sellers WHERE seller_id = ANY($1::varchar[])", values: [sellerIds] }) : { rows: [{ count: "0" }] };
    add("focused PostgreSQL acceptance rows are cleaned up", remaining.rows[0]?.count === "0");
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ phase: "D4-B3.1a", summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases }, null, 2)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error: unknown) => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ phase: "D4-B3.1a", ok: false, message: error instanceof Error ? error.message : "connection product binding acceptance failed" })}\n`);
  process.exitCode = 1;
});
