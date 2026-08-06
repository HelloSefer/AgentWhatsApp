import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import {
  closeDatabasePool,
  createTenantContext,
  executeDatabaseQuery,
} from "../../../infrastructure/database";
import { closeValkeyClient } from "../../../infrastructure/valkey/valkey.client";
import { runtimeReadComposition } from "../../../composition/runtime-read/runtime-read-composition.runtime";
import { CatalogService, PostgreSqlCatalogRepository } from "../../catalog";
import {
  ConversationConfigService,
  PostgreSqlConversationConfigRepository,
} from "../../conversation-config";
import { SellerService } from "../../seller/application/seller.service";
import { PostgreSqlSellerRepository } from "../../seller/infrastructure/postgresql/postgresql-seller.repository";
import { PostgreSqlSellerWorkspaceProfileRepository } from "../../seller-workspace-profile";
import { SellerCommerceConfigRepository } from "../../seller-commerce-config";
import {
  PostgreSqlWhatsAppConnectionRepository,
  WhatsAppConnectionProductBindingService,
} from "../../whatsapp-connection";
import {
  buildCloudAgentIdentity,
  processNormalizedCloudMessage,
  sendDocument,
} from "../../whatsapp/cloud/whatsapp-cloud.service";
import type { WhatsAppCloudSendResult } from "../../whatsapp/cloud/whatsapp-cloud.types";
import { normalizeItemOptionActionId } from "../order/item-collection/actions/item-option-action-normalizer.service";
import {
  clearConversationSession,
  getConversationSession,
} from "../session/conversation-session.service";

dotenv.config();

type Assertion = Readonly<{ name: string; passed: boolean }>;
type CloudResult = Awaited<ReturnType<typeof processNormalizedCloudMessage>>;
type DocumentInput = Parameters<typeof sendDocument>[0];
type DocumentTransport = (input: DocumentInput) => Promise<WhatsAppCloudSendResult>;

const assertions: Assertion[] = [];
const add = (name: string, passed: boolean): void => {
  assertions.push({ name, passed });
};
const id = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/gu, "")}`;
const numericId = (prefix: string): string => `${prefix}${randomUUID().replace(/\D/gu, "").slice(0, 14).padEnd(14, "0")}`;

function product(sellerId: string, productId: string, sizes: readonly [string, string] | readonly [string], colors: readonly [string, string] | readonly [string]) {
  return {
    productId,
    name: "صندالة نسائية",
    description: "وصف كاتالوغ محفوظ",
    price: { amountMinor: 29_900, currencyCode: "MAD" as const },
    availability: "available" as const,
    options: [
      {
        optionId: "size",
        label: "المقاس",
        required: true,
        position: 0,
        values: sizes.map((label, position) => ({
          valueId: `size-${label}`,
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
        values: colors.map((label, position) => ({
          valueId: label === "أصفر" ? "yellow" : "pink",
          label,
          position,
          isAvailable: true,
        })),
      },
    ],
    images: [{ objectKey: `product-images/${sellerId}/${"a".repeat(32)}.png`, mimeType: "image/png" as const, position: 0 }],
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
      { key: "fullName", label: "Full name", required: true, enabled: true },
      { key: "phone", label: "Phone number", required: true, enabled: true },
      { key: "city", label: "City", required: true, enabled: true },
      { key: "address", label: "Delivery address", required: true, enabled: true },
      { key: "quantity", label: "Quantity", required: true, enabled: true },
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

/** These values intentionally disagree with Catalog. They must never become live choices. */
function staleConversationOverride() {
  return {
    schemaVersion: 1,
    locale: "ar-MA",
    productWording: {
      fullName: "صندالة نسائية",
      conversationalName: "الصندالة",
      singularName: "صندالة",
      pluralName: "صندالات",
    },
    options: [
      {
        key: "size",
        label: "مقاس قديم",
        enabled: true,
        requirement: "required" as const,
        order: 0,
        inputType: "list" as const,
        promptMessageKey: "order.first_size_prompt" as const,
        values: [
          { key: "legacy-size-36", canonicalValue: "36", label: "36", enabled: true, available: true, order: 0 },
          { key: "legacy-size-38", canonicalValue: "38", label: "38", enabled: true, available: true, order: 1 },
        ],
      },
      {
        key: "color",
        label: "لون قديم",
        enabled: true,
        requirement: "required" as const,
        order: 1,
        inputType: "list" as const,
        promptMessageKey: "order.item_option_prompt" as const,
        values: [
          { key: "legacy-black", canonicalValue: "أسود", label: "أسود", enabled: true, available: true, order: 0 },
        ],
      },
    ],
  };
}

function actions(result: CloudResult, fieldKey: string) {
  return result.outboundMessages
    .flatMap((message) => message.actionIds)
    .flatMap((rawId) => {
      const normalized = normalizeItemOptionActionId(rawId);
      return normalized.valid && normalized.action?.fieldKey === fieldKey ? [normalized.action] : [];
    });
}

async function main(): Promise<void> {
  const sellerId = id("seller_d4_r2");
  const productId = id("product_d4_r2");
  const tenant = createTenantContext(sellerId);
  const phoneNumberId = numericId("7");
  const customerPhone = "212600000042";
  const sellers = new SellerService(new PostgreSqlSellerRepository());
  const catalog = new CatalogService(new PostgreSqlCatalogRepository());
  const conversations = new ConversationConfigService(new PostgreSqlConversationConfigRepository());
  const profiles = new PostgreSqlSellerWorkspaceProfileRepository();
  const commerce = new SellerCommerceConfigRepository();
  const connections = new PostgreSqlWhatsAppConnectionRepository();
  const binding = new WhatsAppConnectionProductBindingService(connections, catalog);
  const originalInfo = console.info;
  let connectionId = "";
  let identity: ReturnType<typeof buildCloudAgentIdentity> | undefined;

  const reset = async () => {
    if (identity) await clearConversationSession(identity.conversationKey, sellerId);
  };
  const inbound = async (input: { text?: string; actionId?: string; documentTransport?: DocumentTransport }): Promise<CloudResult> => {
    if (!identity) throw new Error("D4_R2_IDENTITY_REQUIRED");
    const text = input.actionId || input.text || "";
    return processNormalizedCloudMessage({
      phoneNumberId,
      waId: customerPhone,
      messageId: id("message"),
      type: input.actionId ? "interactive" : "text",
      text,
      sourceType: input.actionId ? "button_reply" : "text",
      buttonReplyId: input.actionId,
    }, identity, {
      forceDryRun: true,
      ...(input.documentTransport ? { runtimeDocumentTransport: input.documentTransport } : {}),
      connectionScopedRuntime: {
        sellerId,
        connectionId,
        phoneNumberId,
        accessToken: "dry_run_only",
        tokenSource: "encrypted_connection_token",
      },
    });
  };

  try {
    console.info = () => undefined;
    await sellers.createSeller(sellerId);
    await profiles.createProfile({ sellerId, displayName: "D4 R2 Store" });
    await commerce.save(tenant, commerceConfig(sellerId));
    await conversations.saveSellerOverride(tenant, staleConversationOverride());
    await catalog.createProduct(tenant, product(sellerId, productId, ["38", "41"], ["وردي", "أصفر"]));
    const connection = await connections.createManualDraft(tenant, { metaAppId: numericId("8"), publicWebhookId: randomUUID() });
    connectionId = connection.connectionId;
    await connections.persistVerifiedMetadata(tenant, connectionId, {
      metaBusinessId: numericId("9"),
      wabaId: numericId("6"),
      phoneNumberId,
      displayPhoneNumber: "+212600000042",
      verifiedName: "D4 R2 Store",
    });
    await binding.setBoundProductId(tenant, connectionId, productId);
    await connections.updateLifecycleStatus(tenant, connectionId, "ACTIVE");
    identity = buildCloudAgentIdentity({ sellerId, phoneNumberId, waId: customerPhone });

    const projection = await runtimeReadComposition.sellerCommerceProjectionReader.resolve({
      sellerId,
      connectionId,
      phoneNumberId,
    });
    add("persisted runtime projection is ready", projection.status === "READY");
    if (projection.status === "READY") {
      add("generic customer-field defaults render in Darija", projection.sellerConfig.customerFields.map((field) => field.label).join("|") === "الاسم الكامل|رقم الهاتف|المدينة|العنوان|الكمية");
      add("Catalog remains the projection authority for price and mutable values", projection.productContext.price === 299 && projection.productContext.optionGroups.find((group) => group.key === "size")?.valueConfigurations?.map((value) => value.key).join("|") === "size-38|size-41" && projection.productContext.optionGroups.find((group) => group.key === "color")?.valueConfigurations?.map((value) => value.key).join("|") === "pink|yellow");
    }

    await reset();
    const greeting = await inbound({ text: "سلام" });
    add("fresh greeting is split and uses the Catalog price", greeting.outboundMessages.length === 2 && greeting.outboundMessages[0]?.text.includes("299") === true && greeting.outboundMessages.every((message) => message.dryRun));
    const orderNow = await inbound({ actionId: "first_entry:order_now" });
    const initialSizes = actions(orderNow, "size");
    const staleSizeAction = initialSizes.find((action) => action.canonicalValue === "size-38")?.rawId;
    add("first size menu uses only current Catalog ids and scoped identity", initialSizes.map((action) => action.canonicalValue).join("|") === "size-38|size-41" && initialSizes.every((action) => action.productId === productId && action.targetId === "order-entry-size") && !initialSizes.some((action) => action.canonicalValue.includes("legacy") || action.canonicalValue === "size-36"));
    add("first size prompt keeps the accepted Darija wording", orderNow.agentReplyPreview?.includes("المقاس") === true);

    await catalog.replaceProduct(tenant, product(sellerId, productId, ["41"], ["وردي", "أصفر"]));
    const stale = await inbound({ actionId: staleSizeAction });
    const refreshedSizes = actions(stale, "size");
    const staleState = identity
      ? await getConversationSession(identity.conversationKey, sellerId, undefined, customerPhone)
      : undefined;
    add("stale Catalog action is rejected without changing the current order entry", stale.agentReplyPreview?.includes("هاد الاختيار") === true && refreshedSizes.map((action) => action.canonicalValue).join("|") === "size-41" && staleState?.orderRuntime?.pendingInitialItemOptions?.size === undefined);

    const afterSize = await inbound({ actionId: refreshedSizes[0]?.rawId });
    const colors = actions(afterSize, "color");
    add("selecting Catalog size 41 advances to the current Catalog colors", colors.map((action) => action.canonicalValue).join("|") === "pink|yellow" && colors.every((action) => action.productId === productId && action.targetId === "order-entry-color") && afterSize.agentReplyPreview?.includes("اللون") === true);
    const afterColor = await inbound({ actionId: colors.find((action) => action.canonicalValue === "yellow")?.rawId });
    add("golden flow continues from color to the accepted Arabic quantity step", afterColor.outboundMessages.flatMap((message) => message.actionIds).some((action) => action === "cart_quantity:1") && afterColor.agentReplyPreview?.includes("واش بغيتي") === true);

    const twoItems = await inbound({ actionId: "cart_quantity:2" });
    const nextActions = twoItems.outboundMessages.flatMap((message) => message.actionIds);
    add("multi-item continuation preserves the guarded modern cart flow", nextActions.some((action) => action === "cart_item_previous:same" || action === "cart_item_previous:different") || actions(twoItems, "size").every((action) => action.productId === productId));

    const sameAction = nextActions.find((action) => action === "cart_item_previous:same");
    const reviewAfterSame = sameAction ? await inbound({ actionId: sameAction }) : undefined;
    const sameState = identity
      ? await getConversationSession(identity.conversationKey, sellerId, undefined, customerPhone)
      : undefined;
    const sameItem = sameState?.orderRuntime?.cart.items[0];
    add("Same choices copies current Catalog value ids and labels into the cart", sameState?.orderRuntime?.cart.items.length === 1 && sameItem?.quantity === 2 && sameItem.selectedOptions.size === "41" && sameItem.selectedOptions.color === "أصفر" && sameItem.selectedOptionFacts?.map((fact) => `${fact.optionId}:${fact.valueId}:${fact.valueLabel}`).join("|") === "color:yellow:أصفر|size:size-41:41");
    const editMenu = reviewAfterSame ? await inbound({ actionId: "cart_review:edit" }) : undefined;
    const selectItemAction = editMenu?.outboundMessages
      .flatMap((message) => message.actionIds)
      .find((action) => action.startsWith("cart_review_item:select:"));
    const itemActions = selectItemAction ? await inbound({ actionId: selectItemAction }) : undefined;
    const editOptionsAction = itemActions?.outboundMessages
      .flatMap((message) => message.actionIds)
      .find((action) => action.startsWith("cart_review_item:option:size:"));
    const editOptions = editOptionsAction ? await inbound({ actionId: editOptionsAction }) : undefined;
    const cartEditSizes = editOptions ? actions(editOptions, "size") : [];
    add("cart edit uses current Catalog values with the completed item as its scoped target", cartEditSizes.map((action) => action.canonicalValue).join("|") === "size-41" && cartEditSizes.every((action) => action.productId === productId && action.targetId && action.targetId !== "order-entry-size"));
    const afterSizeEdit = cartEditSizes[0] ? await inbound({ actionId: cartEditSizes[0].rawId }) : undefined;
    const colorEditMenu = afterSizeEdit ? await inbound({ actionId: "cart_review:edit" }) : undefined;
    const colorSelectItem = colorEditMenu?.outboundMessages
      .flatMap((message) => message.actionIds)
      .find((action) => action.startsWith("cart_review_item:select:"));
    const colorItemActions = colorSelectItem ? await inbound({ actionId: colorSelectItem }) : undefined;
    const colorEditAction = colorItemActions?.outboundMessages
      .flatMap((message) => message.actionIds)
      .find((action) => action.startsWith("cart_review_item:option:color:"));
    const colorEditOptions = colorEditAction ? await inbound({ actionId: colorEditAction }) : undefined;
    const cartEditColors = colorEditOptions ? actions(colorEditOptions, "color") : [];
    add("cart color edit uses the current Catalog color and keeps the other option", cartEditColors.map((action) => action.canonicalValue).join("|") === "pink|yellow" && cartEditColors.every((action) => action.productId === productId && action.targetId && action.targetId !== "order-entry-color"));
    const afterColorEdit = cartEditColors.find((action) => action.canonicalValue === "yellow")
      ? await inbound({ actionId: cartEditColors.find((action) => action.canonicalValue === "yellow")!.rawId })
      : undefined;
    const deliveryStart = afterColorEdit ? await inbound({ actionId: "cart_review:continue" }) : undefined;
    add("delivery begins with the approved Darija name phone city group", deliveryStart?.agentReplyPreview?.includes("الاسم الكامل") === true && deliveryStart.agentReplyPreview?.includes("رقم الهاتف") === true && deliveryStart.agentReplyPreview?.includes("المدينة") === true && !/Full name|Phone number|City|Delivery address/u.test(deliveryStart.agentReplyPreview || ""));
    const addressPrompt = deliveryStart ? await inbound({ text: "ليلى، 0612345678، الرباط" }) : undefined;
    add("delivery asks for address only after the identity group", addressPrompt?.agentReplyPreview?.includes("العنوان") === true && !/Full name|Phone number|City|Delivery address/u.test(addressPrompt.agentReplyPreview || ""));
    const finalReview = addressPrompt ? await inbound({ text: "حي السلام 12" }) : undefined;
    const deliveryState = identity
      ? await getConversationSession(identity.conversationKey, sellerId, undefined, customerPhone)
      : undefined;
    add("final review retains the current price and Catalog facts", deliveryState?.orderRuntime?.runtimeStage === "FINAL_ORDER_REVIEW" && deliveryState.orderRuntime?.cart.items[0]?.unitPriceAmountMinor === 29_900 && deliveryState.orderRuntime?.cart.items[0]?.selectedOptionFacts?.some((fact) => fact.valueId === "size-41" && fact.valueLabel === "41") === true && deliveryState.orderRuntime?.cart.items[0]?.selectedOptionFacts?.some((fact) => fact.valueId === "yellow" && fact.valueLabel === "أصفر") === true && finalReview?.outboundMessages.some((message) => message.text.includes("598")) === true);

    const renderedReceipts: Buffer[] = [];
    const confirmation = await inbound({
      actionId: "order_checkout:confirm",
      documentTransport: async (input) => {
        renderedReceipts.push(await readFile(input.filePath));
        return {
          success: true,
          dryRun: true,
          payload: { type: "document", filename: input.filename, mimeType: "application/pdf" },
          response: { dryRun: true },
          mediaId: "d4-r2-dry-run-receipt",
        };
      },
    });
    const confirmedState = identity
      ? await getConversationSession(identity.conversationKey, sellerId, undefined, customerPhone)
      : undefined;
    add("confirmation persists one durable order and renders the approved PDF receipt", confirmedState?.orderRuntime?.runtimeStage === "CONFIRMED" && confirmation.outboundMessages[0]?.kind === "text" && confirmation.outboundMessages[1]?.kind === "document" && renderedReceipts.length === 1 && renderedReceipts[0]?.subarray(0, 5).toString("ascii") === "%PDF-");
    const duplicateConfirmation = await inbound({ actionId: "order_checkout:confirm" });
    add("duplicate confirmation keeps the durable order and receipt idempotent", confirmedState?.orderRuntime?.confirmed?.snapshotId === (identity ? (await getConversationSession(identity.conversationKey, sellerId, undefined, customerPhone)).orderRuntime?.confirmed?.snapshotId : undefined) && renderedReceipts.length === 1 && !duplicateConfirmation.outboundMessages.some((message) => message.kind === "document"));

    await reset();
    await inbound({ text: "سلام" });
    const differentOrder = await inbound({ actionId: "first_entry:order_now" });
    const differentSize = actions(differentOrder, "size").find((action) => action.canonicalValue === "size-41");
    const differentColorReply = differentSize ? await inbound({ actionId: differentSize.rawId }) : undefined;
    const differentColor = differentColorReply ? actions(differentColorReply, "color").find((action) => action.canonicalValue === "yellow") : undefined;
    const differentQuantityReply = differentColor ? await inbound({ actionId: differentColor.rawId }) : undefined;
    const differentTwoItems = differentQuantityReply ? await inbound({ actionId: "cart_quantity:2" }) : undefined;
    const differentAction = differentTwoItems?.outboundMessages
      .flatMap((message) => message.actionIds)
      .find((action) => action === "cart_item_previous:different");
    const differentMenu = differentAction ? await inbound({ actionId: differentAction }) : undefined;
    const differentSizes = differentMenu ? actions(differentMenu, "size") : [];
    add("Different choices regenerates the current Catalog size menu", differentSizes.map((action) => action.canonicalValue).join("|") === "size-41" && differentSizes.every((action) => action.productId === productId && action.targetId && action.targetId !== "order-entry-size"));
    add("connected production seam never uses a global token", twoItems.outboundMessages.every((message) => message.dryRun) && twoItems.outboundMessages.length > 0);
  } finally {
    console.info = originalInfo;
    await reset();
    await executeDatabaseQuery({ text: "DELETE FROM orders WHERE seller_id = $1", values: [sellerId] });
    await executeDatabaseQuery({ text: "DELETE FROM whatsapp_connections WHERE seller_id = $1", values: [sellerId] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_conversation_configs WHERE seller_id = $1", values: [sellerId] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_commerce_configs WHERE seller_id = $1", values: [sellerId] });
    await executeDatabaseQuery({ text: "DELETE FROM seller_workspace_profiles WHERE seller_id = $1", values: [sellerId] });
    await executeDatabaseQuery({ text: "DELETE FROM products WHERE seller_id = $1", values: [sellerId] });
    await executeDatabaseQuery({ text: "DELETE FROM sellers WHERE seller_id = $1", values: [sellerId] });
    await closeValkeyClient();
    await closeDatabasePool();
  }

  const failed = assertions.filter((assertion) => !assertion.passed);
  process.stdout.write(`${JSON.stringify({ phase: "D4-R2", summary: { total: assertions.length, passed: assertions.length - failed.length, failed: failed.length }, assertions }, null, 2)}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (error: unknown) => {
  await closeValkeyClient();
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ phase: "D4-R2", ok: false, message: error instanceof Error ? error.message : "dynamic options golden-flow acceptance failed" })}\n`);
  process.exitCode = 1;
});
