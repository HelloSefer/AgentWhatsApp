import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPersistenceComposition } from "../../../composition/persistence/create-persistence-composition";
import { closeDatabasePool, createTenantContext, executeDatabaseQuery } from "../../../infrastructure/database";
import { closeValkeyClient } from "../../../infrastructure/valkey/valkey.client";
import { clearConversationSession } from "../../agent/session/conversation-session.service";
import { generateAgentResult } from "../../agent/agent.service";
import { normalizeItemOptionActionId } from "../../agent/order/item-collection/actions/item-option-action-normalizer.service";
import { conversationConfigValidator } from "../../conversation-engine";
import { validateCatalogProductInput } from "../../catalog";
import {
  SellerCommerceConfigRepository,
} from "../../seller-commerce-config";
import { canonicalSellerCommerceConfigFromLegacy } from "../../seller-commerce-config/seller-commerce-config.mapper";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import {
  PostgreSqlWhatsAppConnectionRepository,
  WhatsAppConnectionProductBindingService,
} from "../../whatsapp-connection";
import {
  buildSandalsDevelopmentCatalogProductInput,
  buildSandalsDevelopmentProductConversationConfig,
  buildSandalsDevelopmentRuntimeProductContext,
  buildSandalsDevelopmentSellerConversationConfig,
  buildSandalsDevelopmentSellerConfig,
  getHistoricalSandalsInventory,
  SANDALS_DEVELOPMENT_PRODUCT_ID,
  SANDALS_DEVELOPMENT_STORE_NAME,
  SANDALS_DEVELOPMENT_TEMPLATE_ID,
} from "../sandals-development-template";

type TestCase = Readonly<{ name: string; passed: boolean; details?: string }>;
const cases: TestCase[] = [];
const add = (name: string, passed: boolean, details?: string): void => {
  cases.push({ name, passed, ...(details ? { details } : {}) });
};

async function source(file: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), "src", file), "utf8");
}

function optionIds(result: Awaited<ReturnType<typeof generateAgentResult>>): string[] {
  return (result.meta?.replyUi?.options || []).map((option) => option.id);
}

async function cleanupTenant(sellerId: string, conversationKey: string): Promise<void> {
  await clearConversationSession(conversationKey, sellerId, SANDALS_DEVELOPMENT_PRODUCT_ID);
  await executeDatabaseQuery({ text: "DELETE FROM whatsapp_connections WHERE seller_id = $1", values: [sellerId] });
  await executeDatabaseQuery({ text: "DELETE FROM whatsapp_transactional_outbox WHERE seller_id = $1", values: [sellerId] });
  await executeDatabaseQuery({ text: "DELETE FROM orders WHERE seller_id = $1", values: [sellerId] });
  await executeDatabaseQuery({ text: "DELETE FROM seller_conversation_configs WHERE seller_id = $1", values: [sellerId] });
  await executeDatabaseQuery({ text: "DELETE FROM seller_commerce_configs WHERE seller_id = $1", values: [sellerId] });
  await executeDatabaseQuery({ text: "DELETE FROM seller_workspace_profiles WHERE seller_id = $1", values: [sellerId] });
  await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = $1", values: [sellerId] });
  await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = $1", values: [sellerId] });
}

function numericId(prefix: string): string {
  const digits = randomUUID().replace(/\D/gu, "").slice(0, 14).padEnd(14, "0");
  return `${prefix}${digits}`;
}

async function main(): Promise<void> {
  const tenantA = "seller_template_a";
  const tenantB = "seller_template_b";
  const sellerA = buildSandalsDevelopmentSellerConfig(tenantA);
  const sellerB = buildSandalsDevelopmentSellerConfig(tenantB);
  const productA = buildSandalsDevelopmentRuntimeProductContext(tenantA);
  const catalog = validateCatalogProductInput(buildSandalsDevelopmentCatalogProductInput());
  const productConfig = conversationConfigValidator.validate(buildSandalsDevelopmentProductConversationConfig());
  const inventory = getHistoricalSandalsInventory();

  add("Reusable template has stable internal identity", SANDALS_DEVELOPMENT_TEMPLATE_ID === "sandals-development-template");
  add("Template substitutes arbitrary tenant seller ids", sellerA.sellerId === tenantA && sellerB.sellerId === tenantB);
  add("Template does not alias arbitrary tenants to seller_demo_sandals", sellerA.sellerId !== "seller_demo_sandals" && productA.sellerId !== "seller_demo_sandals");
  add("Template enables guarded multi-item runtime for the target tenant", sellerA.multiItemOrderFlow?.enabled === true && sellerA.multiItemOrderFlow.runtimeMode === "guarded" && sellerA.multiItemOrderFlow.allowedSellerIds?.join("|") === tenantA);
  add("Darija greeting policy is preserved", sellerA.languageStyle === "darija" && sellerA.firstEntryPolicy.enabled && sellerA.firstEntryPolicy.greetingStyle === "friendly");
  add("Payment on delivery and delivery pricing are preserved", sellerA.delivery.paymentOnDelivery === true && sellerA.deliveryPolicy.pricing?.mode === "CITY_RULES");
  add("Required customer and delivery fields are preserved", sellerA.customerFields.map((field) => field.key).join("|") === "fullName|phone|city|address|quantity");
  add("Receipt behavior is preserved", sellerA.receipt.enabled === true && sellerA.receipt.sendAfterConfirmation === true && sellerA.receipt.currency === "MAD");
  add("Development tenant receipt branding is explicit", sellerA.businessName === SANDALS_DEVELOPMENT_STORE_NAME && sellerA.receipt.branding?.storeName === SANDALS_DEVELOPMENT_STORE_NAME);
  add("Development tenant receipt branding rejects historical demo store name", sellerA.receipt.branding?.storeName !== "Élégance Boutique");
  add("Catalog uses canonical development product id", catalog.productId === SANDALS_DEVELOPMENT_PRODUCT_ID);
  add("Historical product name and description are preserved", catalog.name === "صندالة نسائية" && catalog.description === "صندالة نسائية مناسبة للاستعمال اليومي والخروج.");
  add("Historical valid MAD price is preserved in minor units", catalog.price.amountMinor === 19_900 && catalog.price.currencyCode === "MAD");
  add("Required size option values are preserved", catalog.options.find((option) => option.optionId === "size")?.values.map((value) => value.label).join("|") === "36|37|38|39|40");
  add("Required color option values are preserved", catalog.options.find((option) => option.optionId === "color")?.values.map((value) => value.label).join("|") === "أسود|وردي|أبيض");
  add("Product media and benefits remain available to the runtime template", productA.images.some((image) => image.includes("demo-sandal-product-cropped.png")) && productA.benefits.length === 3);
  add("Conversation product wording validates", productConfig.valid, JSON.stringify(productConfig.errors));
  add("Conversation product wording preserves customer-facing product name", productConfig.normalizedConfig?.productWording?.fullName === "صندالة نسائية");
  add("Conversation option ids are stable while labels remain customer-facing", productConfig.normalizedConfig?.options?.find((option) => option.key === "color")?.values.map((value) => `${value.key}:${value.label}`).join("|") === "black:أسود|pink:وردي|white:أبيض");
  add("Inventory classifies fixed engine behavior", Array.isArray(inventory.fixedEngineBehavior) && inventory.fixedEngineBehavior.length >= 7);
  add("Inventory records legacy-only gates that must not be migrated", JSON.stringify(inventory.legacyOnlyTestGatesNotMigrated).includes("WHATSAPP_CLOUD_ACCESS_TOKEN"));

  const resetCommandSource = await source("modules/development/sandals-development-reset.command.ts");
  const runtimeSource = await source("modules/agent/order/runtime/order-runtime-router.service.ts");
  const agentSource = await source("modules/agent/agent.service.ts");
  add("Reset command requires explicit development mode", resetCommandSource.includes("AGENTWHATSAPP_DEVELOPMENT_RESET") && resetCommandSource.includes("NODE_ENV"));
  add("Reset command resolves ACTIVE customer-owned connection dynamically", resetCommandSource.includes("connection_method = $2") && resetCommandSource.includes("CUSTOMER_OWNED_META_APP") && resetCommandSource.includes("ACTIVE"));
  add("Reset command preserves WhatsApp connection rows", !/DELETE\s+FROM\s+whatsapp_connections/iu.test(resetCommandSource));
  add("Reset command uses tenant-scoped SQL deletes only", !/DELETE\s+FROM\s+(?:products|orders|seller_conversation_configs|whatsapp_transactional_outbox)(?!\s+WHERE\s+seller_id\s+=\s+\$1)/iu.test(resetCommandSource));
  add("Reset command clears only tenant-scoped Valkey keys", resetCommandSource.includes("session:${sellerId}:*") && resetCommandSource.includes("buffer:${sellerId}:*") && resetCommandSource.includes("lock:${sellerId}:*"));
  add("Runtime resolves arbitrary tenants through the exact persisted connection projection", runtimeSource.includes("sellerCommerceProjectionReader.resolve") && runtimeSource.includes("connectionId: input.connectionId") && runtimeSource.includes("phoneNumberId: input.phoneNumberId") && !runtimeSource.includes("buildSandalsDevelopmentSellerConfig("));
  add("Agent resolves persisted Catalog facts before information or order routing", agentSource.includes("sellerCommerceProjectionReader.resolve") && agentSource.includes("firstEntryProductContext: projection.productContext") && agentSource.includes("applyConnectedCatalogConversationPresentation"));
  add("Runtime receipt path snapshots tenant branding from active seller config", runtimeSource.includes("const receiptBranding = sellerConfig.receipt.branding") && runtimeSource.includes("storeName: receiptBranding?.storeName || sellerConfig.businessName"));
  add("New development template code has no global-token dependency", !/WHATSAPP_CLOUD_ACCESS_TOKEN|FIRST_ENTRY_LIVE_SMOKE_/u.test(`${resetCommandSource}\n${runtimeSource}\n${agentSource}`));

  const persistedSeller = `seller_modern_sandals_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;
  const customerPhone = "212600088881";
  const conversationKey = `${persistedSeller}:${customerPhone}`;
  const capturedWarnings: string[] = [];
  const previousWarn = console.warn;
  try {
    console.warn = (...args: unknown[]) => {
      capturedWarnings.push(args.map(String).join(" "));
      previousWarn(...args);
    };
    const tenant = createTenantContext(persistedSeller);
    const persistence = createPersistenceComposition();
    const commerce = new SellerCommerceConfigRepository();
    const profiles = new PostgreSqlSellerWorkspaceProfileRepository();
    const connections = new PostgreSqlWhatsAppConnectionRepository();
    const binding = new WhatsAppConnectionProductBindingService(
      connections,
      persistence.catalogService,
    );
    const phoneNumberId = numericId("7");
    await persistence.sellerService.createSeller(persistedSeller);
    await profiles.createProfile({
      sellerId: persistedSeller,
      displayName: SANDALS_DEVELOPMENT_STORE_NAME,
    });
    await commerce.save(
      tenant,
      canonicalSellerCommerceConfigFromLegacy(
        buildSandalsDevelopmentSellerConfig(persistedSeller),
      ),
    );
    await persistence.catalogService.createProduct(tenant, buildSandalsDevelopmentCatalogProductInput());
    await persistence.conversationConfigService.saveSellerOverride(tenant, buildSandalsDevelopmentSellerConversationConfig());
    await persistence.conversationConfigService.saveProductOverride(
      tenant,
      SANDALS_DEVELOPMENT_PRODUCT_ID,
      buildSandalsDevelopmentProductConversationConfig(),
    );
    const connection = await connections.createManualDraft(tenant, {
      metaAppId: numericId("8"),
      publicWebhookId: randomUUID(),
    });
    await connections.persistVerifiedMetadata(tenant, connection.connectionId, {
      metaBusinessId: numericId("9"),
      wabaId: numericId("6"),
      phoneNumberId,
      displayPhoneNumber: "+212600088881",
      verifiedName: SANDALS_DEVELOPMENT_STORE_NAME,
    });
    await binding.setBoundProductId(
      tenant,
      connection.connectionId,
      SANDALS_DEVELOPMENT_PRODUCT_ID,
    );
    await connections.updateLifecycleStatus(tenant, connection.connectionId, "ACTIVE");
    const firstEntry = await generateAgentResult("سلام", undefined, {
      sellerId: persistedSeller,
      customerPhone,
      conversationKey,
      productId: SANDALS_DEVELOPMENT_PRODUCT_ID,
      connectionId: connection.connectionId,
      phoneNumberId,
      useMemory: true,
      orderRuntimeEnabled: true,
      interactiveSendChannel: "whatsapp_cloud",
      transportInput: {
        normalizedText: "سلام",
        sourceType: "text",
      },
    });
    const presentation = firstEntry.meta?.firstEntryPresentation;
    const messages = presentation?.messages || [];
    const ctaIds = messages
      .flatMap((message) => message.kind === "interactive_buttons" && Array.isArray(message.buttons)
        ? message.buttons.map((button) => button.id)
        : []);
    add("Persisted arbitrary tenant greeting produces split_info_and_cta", presentation?.handledBy === "hybrid_first_entry" && presentation.presentationMode === "split_info_and_cta");
    add("Persisted arbitrary tenant first entry keeps product intro separate from CTA", messages.length === 2 && messages[0]?.kind === "text" && messages[1]?.kind === "interactive_buttons" && messages[0]?.text.includes("صندالة نسائية") && !messages[1]?.text.includes("صندالة نسائية"));
    add("Persisted arbitrary tenant first entry exposes modern CTA ids", ctaIds.join("|") === "first_entry:order_now|first_entry:more_info");
    add("Persisted arbitrary tenant greeting does not ask for size", !JSON.stringify(messages).includes("اختار المقاس"));
    const orderNow = await generateAgentResult("first_entry:order_now", undefined, {
      sellerId: persistedSeller,
      customerPhone,
      conversationKey,
      productId: SANDALS_DEVELOPMENT_PRODUCT_ID,
      connectionId: connection.connectionId,
      phoneNumberId,
      useMemory: true,
      orderRuntimeEnabled: true,
      interactiveSendChannel: "whatsapp_cloud",
      transportInput: {
        actionId: "first_entry:order_now",
        normalizedText: "first_entry:order_now",
        sourceType: "button_reply",
      },
    });
    const ids = optionIds(orderNow);
    add("Persisted arbitrary tenant Order Now enters modern guarded runtime", orderNow.meta?.orderRuntime?.stage === "PLANNING");
    add("Persisted arbitrary tenant Order Now emits scoped cart_item_option actions", ids.some((id) => {
      const action = normalizeItemOptionActionId(id);
      return action.valid && action.action?.fieldKey === "size" && action.action.productId === SANDALS_DEVELOPMENT_PRODUCT_ID && action.action.targetId === "order-entry-size";
    }));
    add("Persisted arbitrary tenant Order Now does not emit old size action", ids.every((id) => !/^size:/u.test(id)));
    add("Persisted arbitrary tenant normal path emits no safe-default warnings", !capturedWarnings.join("\n").includes("safe default"));
  } finally {
    console.warn = previousWarn;
    await cleanupTenant(persistedSeller, conversationKey);
    await closeValkeyClient();
    await closeDatabasePool();
  }

  const failed = cases.filter((entry) => !entry.passed);
  console.log(JSON.stringify({
    phase: "sandals-development-template",
    summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length },
    cases,
  }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
