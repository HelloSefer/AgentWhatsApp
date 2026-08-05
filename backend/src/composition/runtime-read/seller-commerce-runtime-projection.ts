import { createTenantContext } from "../../infrastructure/database";
import { mapCatalogProductToRuntimeContext } from "./runtime-catalog-reader";
import type { CatalogService } from "../../modules/catalog";
import type { ConversationConfigService } from "../../modules/conversation-config";
import type { SellerWorkspaceProfileRepository } from "../../modules/seller-workspace-profile";
import { SellerCommerceConfigRuntimeReader } from "../../modules/seller-commerce-config";
import type { SellerConfig } from "../../modules/agent/config/seller-config.types";

export type SellerCommerceRuntimeProjection = Readonly<{ status: "READY"; sellerConfig: SellerConfig; productContext: NonNullable<ReturnType<typeof mapCatalogProductToRuntimeContext>>; conversationConfig: unknown; receiptBranding: Readonly<{ storeName: string; showLogo: boolean }> }>;
export type SellerCommerceRuntimeProjectionResolution = SellerCommerceRuntimeProjection | Readonly<{ status: "SELLER_COMMERCE_CONFIG_REQUIRED" | "SELLER_COMMERCE_CONFIG_INVALID" }>;

export class SellerCommerceRuntimeProjectionReader {
  constructor(private readonly dependencies: Readonly<{ commerceConfigReader: SellerCommerceConfigRuntimeReader; catalogService: CatalogService; conversationConfigService: ConversationConfigService; workspaceProfileRepository: SellerWorkspaceProfileRepository }>) {}
  async resolve(input: Readonly<{ sellerId: string; productId: string }>): Promise<SellerCommerceRuntimeProjectionResolution> {
    const commerce = await this.dependencies.commerceConfigReader.resolve(input.sellerId);
    if (commerce.status !== "READY") return commerce;
    try {
      const tenant = createTenantContext(input.sellerId);
      const [profile, catalog, conversation] = await Promise.all([this.dependencies.workspaceProfileRepository.findByTenantContext(tenant), this.dependencies.catalogService.getProduct(tenant, input.productId), this.dependencies.conversationConfigService.getSellerOverride(tenant)]);
      const productContext = catalog ? mapCatalogProductToRuntimeContext(catalog) : undefined;
      if (!profile || !productContext || productContext.sellerId !== input.sellerId) return { status: "SELLER_COMMERCE_CONFIG_INVALID" };
      const config = commerce.config;
      const pricing = config.delivery.pricing;
      const sellerConfig: SellerConfig = { sellerId: input.sellerId, businessName: profile.displayName, languageStyle: "darija", showPriceOnFirstReply: true, firstEntryPolicy: { enabled: true, showProductName: true, showPrice: true, showDelivery: true, showPayment: true, ctaMode: "order_or_info", greetingStyle: "friendly" }, deliveryPolicy: { enabled: config.delivery.enabled, availability: config.delivery.availability, pricing: { enabled: config.delivery.enabled, mode: pricing.mode, currency: "MAD", ...(pricing.flatRateMinor !== undefined ? { flatRate: pricing.flatRateMinor / 100 } : {}), ...(pricing.rules ? { rules: pricing.rules.map(({ amountMinor, cityKeys, aliases, ...rule }) => ({ ...rule, cityKeys: [...cityKeys], ...(aliases ? { aliases: [...aliases] } : {}), ...(amountMinor !== undefined ? { amount: amountMinor / 100 } : {}) })) } : {}), ...(pricing.defaultRule ? { defaultRule: (({ amountMinor, ...rule }) => ({ ...rule, ...(amountMinor !== undefined ? { amount: amountMinor / 100 } : {}) }))(pricing.defaultRule) } : {}) } }, delivery: { enabled: config.delivery.enabled, free: pricing.mode === "ALL_FREE", paymentOnDelivery: config.payment.enabled, text: "", paymentText: "" }, customerFields: structuredClone(config.requiredCustomerFields) as SellerConfig["customerFields"], interactive: { firstReplyMode: "auto", optionDisplayMode: "auto", infoMenuDisplayMode: "auto" }, receipt: { ...config.receipt, branding: { storeName: profile.displayName } }, ai: { mode: "hybrid", naturalReplyEnabled: true }, multiItemOrderFlow: structuredClone(config.orderBehavior.multiItemOrderFlow) };
      return { status: "READY", sellerConfig, productContext, conversationConfig: conversation?.config, receiptBranding: { storeName: profile.displayName, showLogo: Boolean(profile.logoObjectKey) && config.receipt.showLogo !== false } };
    } catch { return { status: "SELLER_COMMERCE_CONFIG_INVALID" }; }
  }
}
