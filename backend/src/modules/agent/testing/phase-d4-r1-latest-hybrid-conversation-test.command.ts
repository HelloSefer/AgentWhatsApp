import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
} from "../../../infrastructure/database";
import { closeValkeyClient } from "../../../infrastructure/valkey/valkey.client";
import { CatalogService, PostgreSqlCatalogRepository } from "../../catalog";
import {
  ConversationConfigService,
  PostgreSqlConversationConfigRepository,
} from "../../conversation-config";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import {
  SellerCommerceConfigRepository,
} from "../../seller-commerce-config";
import {
  PostgreSqlWhatsAppConnectionRepository,
  WhatsAppConnectionProductBindingService,
} from "../../whatsapp-connection";
import {
  buildCloudAgentIdentity,
  processNormalizedCloudMessage,
} from "../../whatsapp/cloud/whatsapp-cloud.service";
import {
  clearConversationSession,
  getConversationSession,
} from "../session/conversation-session.service";
import { normalizeItemOptionActionId } from "../order/item-collection/actions/item-option-action-normalizer.service";

dotenv.config();

type Assertion = Readonly<{ name: string; passed: boolean }>;

const assertions: Assertion[] = [];

function add(name: string, passed: boolean): void {
  assertions.push({ name, passed });
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, "")}`;
}

function numericId(prefix: string): string {
  const digits = randomUUID().replace(/\D/gu, "").slice(0, 14).padEnd(14, "0");
  return `${prefix}${digits}`;
}

function catalogProduct(input: {
  productId: string;
  name: string;
  priceAmountMinor: number;
  sizes: readonly string[];
  colors: readonly string[];
  availability?: "available" | "unavailable";
}) {
  return {
    productId: input.productId,
    name: input.name,
    description: `${input.name} description`,
    price: { amountMinor: input.priceAmountMinor, currencyCode: "MAD" as const },
    availability: input.availability || "available",
    options: [
      {
        optionId: "size",
        label: "المقاس",
        required: true,
        position: 0,
        values: input.sizes.map((label, position) => ({
          valueId: `size_${label}`,
          label,
          position,
          isAvailable: true,
        })),
      },
      {
        optionId: "color",
        label: "اللون",
        required: true,
        position: 1,
        values: input.colors.map((label, position) => ({
          valueId: `color_${position}`,
          label,
          position,
          isAvailable: true,
        })),
      },
    ],
    images: [],
    aliases: [],
    offers: [],
  };
}

function commerceConfig(sellerId: string) {
  return {
    configVersion: 1,
    payment: { method: "COD" as const, enabled: true },
    delivery: {
      enabled: true,
      availability: "all_cities" as const,
      pricing: { mode: "ALL_FREE" as const, currency: "MAD" as const },
    },
    requiredCustomerFields: [
      { key: "fullName", label: "الاسم الكامل", required: true, enabled: true },
      { key: "phone", label: "رقم الهاتف", required: true, enabled: true },
      { key: "city", label: "المدينة", required: true, enabled: true },
      { key: "address", label: "العنوان", required: true, enabled: true },
    ],
    orderBehavior: {
      multiItemOrderFlow: {
        enabled: true,
        runtimeMode: "guarded" as const,
        allowedSellerIds: [sellerId],
      },
    },
    receipt: { enabled: true, sendAfterConfirmation: true },
  };
}

function actionIds(result: Awaited<ReturnType<typeof processNormalizedCloudMessage>>): string[] {
  return result.outboundMessages.flatMap((message) => message.actionIds);
}

function configuredOptionActions(result: Awaited<ReturnType<typeof processNormalizedCloudMessage>>, fieldKey: string) {
  return actionIds(result).flatMap((actionId) => {
    const normalized = normalizeItemOptionActionId(actionId);
    return normalized.valid && normalized.action?.fieldKey === fieldKey
      ? [normalized.action]
      : [];
  });
}

async function main(): Promise<void> {
  const sellerId = id("seller_d4_r1");
  const tenant = createTenantContext(sellerId);
  const productA = id("product_d4_r1_a");
  const productB = id("product_d4_r1_b");
  const initialPriceMinor = 19_900;
  const changedPriceMinor = 24_900;
  const initialSizes = ["36", "38"];
  const changedSizes = ["37", "40"];
  const colors = ["أسود", "وردي"];
  const phoneNumberId = numericId("7");
  const customerPhone = "212600000000";
  const sellers = new SellerService(new PostgreSqlSellerRepository());
  const catalog = new CatalogService(new PostgreSqlCatalogRepository());
  const conversations = new ConversationConfigService(
    new PostgreSqlConversationConfigRepository(),
  );
  const profiles = new PostgreSqlSellerWorkspaceProfileRepository();
  const commerce = new SellerCommerceConfigRepository();
  const connections = new PostgreSqlWhatsAppConnectionRepository();
  const binding = new WhatsAppConnectionProductBindingService(connections, catalog);
  const originalInfo = console.info;
  let identity: ReturnType<typeof buildCloudAgentIdentity> | undefined;
  let connectionId = "";

  const reset = async () => {
    if (identity) {
      await clearConversationSession(identity.conversationKey, sellerId);
    }
  };
  const state = async () => {
    if (!identity) throw new Error("D4_R1_IDENTITY_REQUIRED");
    return getConversationSession(
      identity.conversationKey,
      sellerId,
      undefined,
      customerPhone,
    );
  };
  const inbound = async (input: {
    text?: string;
    actionId?: string;
  }) => {
    if (!identity) throw new Error("D4_R1_IDENTITY_REQUIRED");
    const actionId = input.actionId;
    const text = actionId || input.text || "";
    return processNormalizedCloudMessage(
      {
        phoneNumberId,
        waId: customerPhone,
        messageId: id("message"),
        type: actionId ? "interactive" : "text",
        text,
        sourceType: actionId ? "button_reply" : "text",
        buttonReplyId: actionId,
      },
      identity,
      {
        forceDryRun: true,
        connectionScopedRuntime: {
          sellerId,
          connectionId,
          phoneNumberId,
          accessToken: "dry_run_only",
          tokenSource: "encrypted_connection_token",
        },
      },
    );
  };

  try {
    console.info = () => undefined;
    await sellers.createSeller(sellerId);
    await profiles.createProfile({ sellerId, displayName: "D4 R1 Store" });
    await commerce.save(tenant, commerceConfig(sellerId));
    await conversations.saveSellerOverride(tenant, { schemaVersion: 1 });
    await catalog.createProduct(
      tenant,
      catalogProduct({
        productId: productA,
        name: "D4 R1 Bound Product A",
        priceAmountMinor: initialPriceMinor,
        sizes: initialSizes,
        colors,
      }),
    );
    await catalog.createProduct(
      tenant,
      catalogProduct({
        productId: productB,
        name: "D4 R1 Bound Product B",
        priceAmountMinor: 15_900,
        sizes: ["41"],
        colors: ["أبيض"],
      }),
    );
    const connection = await connections.createManualDraft(tenant, {
      metaAppId: numericId("8"),
      publicWebhookId: randomUUID(),
    });
    connectionId = connection.connectionId;
    await connections.persistVerifiedMetadata(tenant, connectionId, {
      metaBusinessId: numericId("9"),
      wabaId: numericId("6"),
      phoneNumberId,
      displayPhoneNumber: "+212600000000",
      verifiedName: "D4 R1 Store",
    });
    await binding.setBoundProductId(tenant, connectionId, productA);
    await connections.updateLifecycleStatus(tenant, connectionId, "ACTIVE");
    identity = buildCloudAgentIdentity({
      sellerId,
      phoneNumberId,
      waId: customerPhone,
    });

    await reset();
    const greeting = await inbound({ text: "سلام" });
    const greetingState = await state();
    const greetingMessages = greeting.outboundMessages;
    const greetingActions = actionIds(greeting);
    add("fresh greeting selects the latest Hybrid First Entry path", greetingState.firstEntry?.shown === true);
    add("fresh greeting sends the configured product introduction before the CTA", greetingMessages.length === 2 && greetingMessages[0]?.kind === "text" && greetingMessages[0]?.text.includes("D4 R1 Bound Product A") && greetingMessages[1]?.kind === "interactive");
    add("fresh greeting uses Catalog minor-unit price and configured delivery", greetingMessages[0]?.text.includes(String(initialPriceMinor / 100)) === true && greetingMessages[0]?.text.includes("التوصيل") === true && greetingMessages[0]?.text.includes("بالمجان") === true);
    add("fresh greeting exposes only the authoritative order and information CTAs", greetingActions.join("|") === "first_entry:order_now|first_entry:more_info");
    add("fresh greeting does not create a cart or request a required option", !greetingState.orderRuntime && !greetingState.orderState.orderCycleId && greetingState.orderState.missingFields.length === 0 && !greetingMessages.some((message) => message.text.includes("اختار المقاس")));
    add("focused Cloud seam remains dry-run only", greetingMessages.every((message) => message.dryRun));

    const moreInfo = await inbound({ actionId: "first_entry:more_info" });
    const moreInfoState = await state();
    add("More Information enters the existing information path", moreInfo.agentSource === "direct" && actionIds(moreInfo).includes("info:price") && actionIds(moreInfo).includes("info:order_now"));
    add("More Information does not start cart or option collection", !moreInfoState.orderRuntime && !moreInfoState.orderState.orderCycleId && !moreInfo.agentReplyPreview?.includes("اختار المقاس"));

    await reset();
    await inbound({ text: "سلام" });
    const orderNow = await inbound({ actionId: "first_entry:order_now" });
    const orderState = await state();
    const sizeActions = configuredOptionActions(orderNow, "size");
    add("explicit Order Now is the only entry that starts the guarded order runtime", orderState.orderRuntime?.runtimeStage === "PLANNING" && sizeActions.length === initialSizes.length);
    add("initial configured option order is dynamic size then color", sizeActions.every((action) => initialSizes.some((size) => action.canonicalValue === `size_${size}`) && action.productId === productA && action.targetId === "order-entry-size") && configuredOptionActions(orderNow, "color").length === 0);
    const afterSize = await inbound({ actionId: sizeActions[0]!.rawId });
    const afterSizeState = await state();
    const colorActions = configuredOptionActions(afterSize, "color");
    add("active order resumes the next configured option instead of First Entry", afterSizeState.orderRuntime?.runtimeStage !== "FIRST_ENTRY" && colorActions.length === colors.length);

    await reset();
    const resetGreeting = await inbound({ text: "سلام" });
    const resetState = await state();
    add("reset clears temporary runtime and stale option progression", resetState.firstEntry?.shown === true && !resetState.orderRuntime && !resetState.orderState.orderCycleId && actionIds(resetGreeting).join("|") === "first_entry:order_now|first_entry:more_info");

    await catalog.replaceProduct(
      tenant,
      catalogProduct({
        productId: productA,
        name: "D4 R1 Bound Product A",
        priceAmountMinor: changedPriceMinor,
        sizes: initialSizes,
        colors,
      }),
    );
    await reset();
    const changedPriceGreeting = await inbound({ text: "سلام" });
    add("Catalog price change updates the next greeting without conversation code changes", changedPriceGreeting.outboundMessages[0]?.text.includes(String(changedPriceMinor / 100)) === true && changedPriceGreeting.outboundMessages[0]?.text.includes(String(initialPriceMinor / 100)) === false && actionIds(changedPriceGreeting).join("|") === "first_entry:order_now|first_entry:more_info");

    await catalog.replaceProduct(
      tenant,
      catalogProduct({
        productId: productA,
        name: "D4 R1 Bound Product A",
        priceAmountMinor: changedPriceMinor,
        sizes: changedSizes,
        colors,
      }),
    );
    await reset();
    await inbound({ text: "سلام" });
    const changedOptionsOrderNow = await inbound({ actionId: "first_entry:order_now" });
    const changedSizeActions = configuredOptionActions(changedOptionsOrderNow, "size");
    add("Catalog option values control available order actions after reset", changedSizeActions.length === changedSizes.length && changedSizeActions.every((action) => changedSizes.some((size) => action.canonicalValue === `size_${size}`) && action.productId === productA && action.targetId === "order-entry-size") && changedSizeActions.every((action) => !initialSizes.some((size) => action.canonicalValue === `size_${size}`)));

    await binding.setBoundProductId(tenant, connectionId, productB);
    await reset();
    const reboundGreeting = await inbound({ text: "سلام" });
    add("exact connection binding changes product facts while preserving First Entry", reboundGreeting.outboundMessages[0]?.text.includes("D4 R1 Bound Product B") === true && reboundGreeting.outboundMessages[0]?.text.includes("D4 R1 Bound Product A") === false && actionIds(reboundGreeting).join("|") === "first_entry:order_now|first_entry:more_info");

    await catalog.setProductAvailability(tenant, productB, "unavailable");
    await reset();
    const unavailableGreeting = await inbound({ text: "سلام" });
    const unavailableState = await state();
    add("unavailable bound product fails closed without a default or demo product", !actionIds(unavailableGreeting).includes("first_entry:order_now") && !unavailableState.orderRuntime && !unavailableState.orderState.orderCycleId);
  } finally {
    console.info = originalInfo;
    await reset();
    await executeDatabaseQuery({
      text: "DELETE FROM whatsapp_connections WHERE seller_id = $1",
      values: [sellerId],
    });
    await executeDatabaseQuery({
      text: "DELETE FROM seller_conversation_configs WHERE seller_id = $1",
      values: [sellerId],
    });
    await executeDatabaseQuery({
      text: "DELETE FROM seller_commerce_configs WHERE seller_id = $1",
      values: [sellerId],
    });
    await executeDatabaseQuery({
      text: "DELETE FROM seller_workspace_profiles WHERE seller_id = $1",
      values: [sellerId],
    });
    await executeDatabaseQuery({
      text: "DELETE FROM products WHERE seller_id = $1",
      values: [sellerId],
    });
    await executeDatabaseQuery({
      text: "DELETE FROM sellers WHERE seller_id = $1",
      values: [sellerId],
    });
    await closeValkeyClient();
    await closeDatabasePool();
  }

  const failed = assertions.filter((assertion) => !assertion.passed);
  process.stdout.write(`${JSON.stringify({
    phase: "D4-R1",
    summary: {
      total: assertions.length,
      passed: assertions.length - failed.length,
      failed: failed.length,
    },
    assertions,
  }, null, 2)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error: unknown) => {
  await closeValkeyClient();
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({
    phase: "D4-R1",
    ok: false,
    message: error instanceof Error ? error.message : "latest Hybrid conversation acceptance failed",
  })}\n`);
  process.exitCode = 1;
});
