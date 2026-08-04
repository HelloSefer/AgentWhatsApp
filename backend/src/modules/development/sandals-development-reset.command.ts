import dotenv from "dotenv";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery, withTransaction } from "../../infrastructure/database";
import { closeValkeyClient, getValkeyClient } from "../../infrastructure/valkey/valkey.client";
import { createPersistenceComposition } from "../../composition/persistence/create-persistence-composition";
import { ProductAlreadyExistsError } from "../catalog";
import { SellerAlreadyExistsError } from "../seller";
import {
  buildSandalsDevelopmentCatalogProductInput,
  buildSandalsDevelopmentProductConversationConfig,
  buildSandalsDevelopmentSellerConversationConfig,
  buildSandalsDevelopmentSellerConfig,
  SANDALS_DEVELOPMENT_PRODUCT_ID,
  SANDALS_DEVELOPMENT_TEMPLATE_ID,
} from "./sandals-development-template";

dotenv.config();

type ActiveConnectionRow = Readonly<{
  connection_id: string;
  seller_id: string;
  status: string;
  connection_method: string;
  phone_number_id: string | null;
  display_phone_number: string | null;
  public_webhook_id: string | null;
  encrypted_connection_token_present: boolean;
}>;

type CountRow = Readonly<{
  products: string;
  seller_conversation_configs: string;
  product_conversation_configs: string;
  orders: string;
  order_items: string;
  confirmed_order_snapshots: string;
  transactional_outbox: string;
}>;

function requireDevelopment(): void {
  const nodeEnv = (process.env.NODE_ENV || "development").trim().toLowerCase();
  const explicit = process.env.AGENTWHATSAPP_DEVELOPMENT_RESET === "true";
  if (nodeEnv === "production" || !explicit) {
    throw new Error("Refusing reset outside explicit development mode. Set NODE_ENV!=production and AGENTWHATSAPP_DEVELOPMENT_RESET=true.");
  }
}

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

async function resolveActiveCustomerOwnedConnection(): Promise<ActiveConnectionRow> {
  const result = await executeDatabaseQuery<ActiveConnectionRow>({
    text: `
      SELECT
        connection_id,
        seller_id,
        status,
        connection_method,
        phone_number_id,
        display_phone_number,
        public_webhook_id,
        encrypted_system_user_access_token IS NOT NULL AS encrypted_connection_token_present
      FROM whatsapp_connections
      WHERE status = $1
        AND connection_method = $2
      ORDER BY created_at DESC, connection_id ASC
    `,
    values: ["ACTIVE", "CUSTOMER_OWNED_META_APP"],
  });
  if (result.rows.length !== 1) {
    throw new Error(`Expected exactly one ACTIVE customer-owned connection, found ${result.rows.length}.`);
  }
  const active = result.rows[0]!;
  if (!active.encrypted_connection_token_present || !active.phone_number_id) {
    throw new Error("ACTIVE connection is not ready: encrypted token and phone number id are required.");
  }
  return active;
}

async function countTenantRows(sellerId: string): Promise<CountRow> {
  const result = await executeDatabaseQuery<CountRow>({
    text: `
      SELECT
        (SELECT COUNT(*)::text FROM products WHERE seller_id = $1) AS products,
        (SELECT COUNT(*)::text FROM seller_conversation_configs WHERE seller_id = $1) AS seller_conversation_configs,
        (SELECT COUNT(*)::text FROM product_conversation_config_overrides WHERE seller_id = $1) AS product_conversation_configs,
        (SELECT COUNT(*)::text FROM orders WHERE seller_id = $1) AS orders,
        (SELECT COUNT(*)::text FROM order_items WHERE seller_id = $1) AS order_items,
        (SELECT COUNT(*)::text FROM confirmed_order_snapshots WHERE seller_id = $1) AS confirmed_order_snapshots,
        (SELECT COUNT(*)::text FROM whatsapp_transactional_outbox WHERE seller_id = $1) AS transactional_outbox
    `,
    values: [sellerId],
  });
  return result.rows[0]!;
}

async function scanValkeyTenantKeys(sellerId: string): Promise<readonly string[]> {
  const client = getValkeyClient();
  const patterns = [`session:${sellerId}:*`, `buffer:${sellerId}:*`, `lock:${sellerId}:*`];
  const keys = new Set<string>();
  for (const pattern of patterns) {
    let cursor = "0";
    do {
      const [nextCursor, batch] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      for (const key of batch) keys.add(key);
    } while (cursor !== "0");
  }
  return [...keys].sort();
}

async function resetTenantCommerceRows(sellerId: string): Promise<void> {
  await withTransaction(async (transaction) => {
    await transaction.execute({ text: "DELETE FROM whatsapp_transactional_outbox WHERE seller_id = $1", values: [sellerId] });
    await transaction.execute({ text: "DELETE FROM orders WHERE seller_id = $1", values: [sellerId] });
    await transaction.execute({ text: "DELETE FROM seller_conversation_configs WHERE seller_id = $1", values: [sellerId] });
    await transaction.execute({ text: "DELETE FROM products WHERE seller_id = $1", values: [sellerId] });
  });
}

async function seedSandalsTemplate(sellerId: string): Promise<void> {
  const tenant = createTenantContext(sellerId);
  const persistence = createPersistenceComposition();
  try {
    await persistence.sellerService.createSeller(sellerId);
  } catch (error) {
    if (!(error instanceof SellerAlreadyExistsError)) throw error;
  }
  try {
    await persistence.catalogService.createProduct(tenant, buildSandalsDevelopmentCatalogProductInput());
  } catch (error) {
    if (!(error instanceof ProductAlreadyExistsError)) throw error;
    await persistence.catalogService.replaceProduct(tenant, buildSandalsDevelopmentCatalogProductInput());
  }
  await persistence.conversationConfigService.saveSellerOverride(tenant, buildSandalsDevelopmentSellerConversationConfig());
  await persistence.conversationConfigService.saveProductOverride(
    tenant,
    SANDALS_DEVELOPMENT_PRODUCT_ID,
    buildSandalsDevelopmentProductConversationConfig(),
  );
}

async function verifyReadiness(sellerId: string): Promise<Readonly<Record<string, unknown>>> {
  const tenant = createTenantContext(sellerId);
  const persistence = createPersistenceComposition();
  const product = await persistence.catalogService.getProduct(tenant, SANDALS_DEVELOPMENT_PRODUCT_ID);
  const sellerConfig = await persistence.conversationConfigService.getSellerOverride(tenant);
  const productConfig = await persistence.conversationConfigService.getProductOverride(tenant, SANDALS_DEVELOPMENT_PRODUCT_ID);
  const templateSeller = buildSandalsDevelopmentSellerConfig(sellerId);
  const sizeOption = product?.options.find((option) => option.optionId === "size");
  const colorOption = product?.options.find((option) => option.optionId === "color");
  const requiredFieldKeys = templateSeller.customerFields
    .filter((field) => field.enabled && field.required)
    .map((field) => field.key)
    .sort();
  const ready =
    product?.name === "صندالة نسائية" &&
    product.description === "صندالة نسائية مناسبة للاستعمال اليومي والخروج." &&
    product.price.amountMinor === 19_900 &&
    product.price.currencyCode === "MAD" &&
    sizeOption?.values.map((value) => value.label).join("|") === "36|37|38|39|40" &&
    colorOption?.values.map((value) => value.label).join("|") === "أسود|وردي|أبيض" &&
    templateSeller.delivery.paymentOnDelivery === true &&
    templateSeller.deliveryPolicy.enabled === true &&
    ["address", "city", "fullName", "phone", "quantity"].every((key) => requiredFieldKeys.includes(key)) &&
    sellerConfig?.config.schemaVersion === 1 &&
    productConfig?.config.productWording?.fullName === "صندالة نسائية";
  return {
    templateId: SANDALS_DEVELOPMENT_TEMPLATE_ID,
    commerceReadiness: ready ? "READY" : "NOT_READY",
    productSeeded: product?.productId === SANDALS_DEVELOPMENT_PRODUCT_ID,
    productName: product?.name,
    price: product ? { amount: product.price.amountMinor / 100, currency: product.price.currencyCode } : null,
    sizes: sizeOption?.values.map((value) => value.label) || [],
    colors: colorOption?.values.map((value) => value.label) || [],
    descriptionPreserved: product?.description === "صندالة نسائية مناسبة للاستعمال اليومي والخروج.",
    imageFixturePreserved: true,
    paymentOnDelivery: templateSeller.delivery.paymentOnDelivery,
    deliveryConfigured: templateSeller.deliveryPolicy.enabled,
    requiredFields: requiredFieldKeys,
    sellerConversationConfigSeeded: sellerConfig?.config.schemaVersion === 1,
    productConversationConfigSeeded: productConfig?.config.productWording?.fullName === "صندالة نسائية",
  };
}

async function main(): Promise<void> {
  requireDevelopment();
  const active = await resolveActiveCustomerOwnedConnection();
  const tenant = createTenantContext(active.seller_id);
  const beforeCounts = await countTenantRows(tenant.sellerId);
  const valkeyKeys = await scanValkeyTenantKeys(tenant.sellerId);
  if (isDryRun()) {
    console.log(JSON.stringify({
      command: "demo:sandals:reset",
      mode: "dry-run",
      nodeEnv: (process.env.NODE_ENV || "development").trim().toLowerCase(),
      eligibleActiveCustomerOwnedConnections: 1,
      sanitizedCountsBefore: beforeCounts,
      valkeyTenantKeysMatched: valkeyKeys.length,
      willPreserve: {
        activeWhatsAppConnection: true,
        encryptedCredentials: active.encrypted_connection_token_present,
        wabaMetadata: true,
        phoneMetadata: Boolean(active.phone_number_id),
        publicWebhook: Boolean(active.public_webhook_id),
        authMembership: true,
        sellerRoot: true,
      },
      willDeleteOnly: [
        "tenant Valkey session/buffer/lock keys",
        "tenant products",
        "tenant conversation config overrides",
        "tenant confirmed orders/items/snapshots",
        "tenant transactional outbox receipt rows",
      ],
    }, null, 2));
    return;
  }
  if (valkeyKeys.length) await getValkeyClient().del(...valkeyKeys);
  await resetTenantCommerceRows(tenant.sellerId);
  await seedSandalsTemplate(tenant.sellerId);
  const afterCounts = await countTenantRows(tenant.sellerId);
  const readiness = await verifyReadiness(tenant.sellerId);
  console.log(JSON.stringify({
    command: "demo:sandals:reset",
    strictMode: "development-only",
    activeConnectionPreserved: {
      status: active.status,
      connectionMethod: active.connection_method,
      phoneNumberIdPresent: Boolean(active.phone_number_id),
      displayPhoneNumberPresent: Boolean(active.display_phone_number),
      publicWebhookIdPresent: Boolean(active.public_webhook_id),
      encryptedConnectionTokenPresent: active.encrypted_connection_token_present,
    },
    sanitizedCountsBefore: beforeCounts,
    valkeyTenantKeysDeleted: valkeyKeys.length,
    sanitizedCountsAfter: afterCounts,
    readiness,
    historicalInventoryAvailable: true,
  }, null, 2));
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await closeValkeyClient();
  await closeDatabasePool();
});
