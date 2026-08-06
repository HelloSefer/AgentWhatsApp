import { createTenantContext } from "../../infrastructure/database";
import { mapCatalogProductToRuntimeContext } from "./runtime-catalog-reader";
import type { CatalogService } from "../../modules/catalog";
import type { ConversationConfigService } from "../../modules/conversation-config";
import type { SellerWorkspaceProfileRepository } from "../../modules/seller-workspace-profile";
import type { WhatsAppConnectionRepository } from "../../modules/whatsapp-connection";
import { SellerCommerceConfigRuntimeReader } from "../../modules/seller-commerce-config";
import type { SellerConfig } from "../../modules/agent/config/seller-config.types";

const DEFAULT_DARIJA_CUSTOMER_FIELD_LABELS: Readonly<Record<string, string>> = {
  fullname: "الاسم الكامل",
  phone: "رقم الهاتف",
  city: "المدينة",
  address: "العنوان",
  deliveryaddress: "العنوان",
  quantity: "الكمية",
};

const GENERIC_ENGLISH_CUSTOMER_FIELD_LABELS = new Set([
  "full name",
  "phone number",
  "city",
  "delivery address",
  "address",
  "quantity",
]);

function normalizeCustomerFieldKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/gu, "");
}

function withDarijaCustomerFieldLabels<T extends { key: string; label: string }>(
  fields: readonly T[],
): T[] {
  return fields.map((field) => {
    const defaultLabel = DEFAULT_DARIJA_CUSTOMER_FIELD_LABELS[
      normalizeCustomerFieldKey(field.key)
    ];
    const normalizedLabel = field.label.trim().toLocaleLowerCase();
    return defaultLabel && GENERIC_ENGLISH_CUSTOMER_FIELD_LABELS.has(normalizedLabel)
      ? { ...field, label: defaultLabel }
      : { ...field };
  });
}

export type SellerCommerceRuntimeProjection = Readonly<{ status: "READY"; sellerConfig: SellerConfig; productContext: NonNullable<ReturnType<typeof mapCatalogProductToRuntimeContext>>; conversationConfig: unknown; receiptBranding: Readonly<{ storeName: string; showLogo: boolean }> }>;
export type SellerCommerceReadinessReason =
  | "SELLER_COMMERCE_CONFIG_REQUIRED"
  | "SELLER_COMMERCE_CONFIG_INVALID"
  | "SELLER_CONVERSATION_CONFIG_REQUIRED"
  | "WHATSAPP_CONNECTION_REQUIRED"
  | "WHATSAPP_CONNECTION_INVALID"
  | "WHATSAPP_PRODUCT_BINDING_REQUIRED"
  | "WHATSAPP_PRODUCT_UNAVAILABLE";
export type SellerCommerceRuntimeProjectionResolution = SellerCommerceRuntimeProjection | Readonly<{
  /** The longstanding public result shape remains bounded for existing runtime callers. */
  status: "SELLER_COMMERCE_CONFIG_REQUIRED" | "SELLER_COMMERCE_CONFIG_INVALID";
  readinessReason: SellerCommerceReadinessReason;
}>;

export class SellerCommerceRuntimeProjectionReader {
  constructor(private readonly dependencies: Readonly<{ commerceConfigReader: SellerCommerceConfigRuntimeReader; catalogService: CatalogService; conversationConfigService: ConversationConfigService; workspaceProfileRepository: SellerWorkspaceProfileRepository; whatsappConnectionRepository: WhatsAppConnectionRepository }>) {}
  /**
   * `productId` remains accepted only to avoid widening the runtime boundary
   * during the persistence migration. The active connection binding is the
   * sole product authority and intentionally supersedes it.
   */
  async resolve(input: Readonly<{ sellerId: string; productId?: string; connectionId?: string; phoneNumberId?: string }>): Promise<SellerCommerceRuntimeProjectionResolution> {
    const commerce = await this.dependencies.commerceConfigReader.resolve(input.sellerId);
    if (commerce.status !== "READY") return { status: commerce.status, readinessReason: commerce.status };
    try {
      const tenant = createTenantContext(input.sellerId);
      // Inbound processing supplies the persisted connection selected from the
      // webhook phone number. Never replace that authority with a seller-wide
      // "current" lookup when an exact connection is available.
      const connection = input.connectionId
        ? await this.dependencies.whatsappConnectionRepository.findByConnectionId(tenant, input.connectionId)
        : input.phoneNumberId
          ? await this.dependencies.whatsappConnectionRepository.findByPhoneNumberIdForSeller(tenant, input.phoneNumberId)
          : await this.dependencies.whatsappConnectionRepository.findActiveBySeller(tenant);
      if (!connection) return { status: "SELLER_COMMERCE_CONFIG_INVALID", readinessReason: "WHATSAPP_CONNECTION_REQUIRED" };
      if (
        connection.status !== "ACTIVE" ||
        !connection.phoneNumberId ||
        !connection.connectedAt ||
        (input.phoneNumberId && connection.phoneNumberId !== input.phoneNumberId)
      ) return { status: "SELLER_COMMERCE_CONFIG_INVALID", readinessReason: "WHATSAPP_CONNECTION_INVALID" };
      if (!connection.boundProductId) return { status: "SELLER_COMMERCE_CONFIG_INVALID", readinessReason: "WHATSAPP_PRODUCT_BINDING_REQUIRED" };

      const [profile, catalog, conversation] = await Promise.all([
        this.dependencies.workspaceProfileRepository.findByTenantContext(tenant),
        this.dependencies.catalogService.getProduct(tenant, connection.boundProductId),
        this.dependencies.conversationConfigService.getSellerOverride(tenant),
      ]);
      const productContext = catalog ? mapCatalogProductToRuntimeContext(catalog) : undefined;
      if (!catalog || catalog.availability !== "available") return { status: "SELLER_COMMERCE_CONFIG_INVALID", readinessReason: "WHATSAPP_PRODUCT_UNAVAILABLE" };
      if (!conversation) return { status: "SELLER_COMMERCE_CONFIG_REQUIRED", readinessReason: "SELLER_CONVERSATION_CONFIG_REQUIRED" };
      if (!profile || !productContext || productContext.sellerId !== input.sellerId) return { status: "SELLER_COMMERCE_CONFIG_INVALID", readinessReason: "SELLER_COMMERCE_CONFIG_INVALID" };
      const config = commerce.config;
      const pricing = config.delivery.pricing;
      const sellerConfig: SellerConfig = { sellerId: input.sellerId, businessName: profile.displayName, languageStyle: "darija", showPriceOnFirstReply: true, firstEntryPolicy: { enabled: true, showProductName: true, showPrice: true, showDelivery: true, showPayment: true, ctaMode: "order_or_info", greetingStyle: "friendly" }, deliveryPolicy: { enabled: config.delivery.enabled, availability: config.delivery.availability, pricing: { enabled: config.delivery.enabled, mode: pricing.mode, currency: "MAD", ...(pricing.flatRateMinor !== undefined ? { flatRate: pricing.flatRateMinor / 100 } : {}), ...(pricing.rules ? { rules: pricing.rules.map(({ amountMinor, cityKeys, aliases, ...rule }) => ({ ...rule, cityKeys: [...cityKeys], ...(aliases ? { aliases: [...aliases] } : {}), ...(amountMinor !== undefined ? { amount: amountMinor / 100 } : {}) })) } : {}), ...(pricing.defaultRule ? { defaultRule: (({ amountMinor, ...rule }) => ({ ...rule, ...(amountMinor !== undefined ? { amount: amountMinor / 100 } : {}) }))(pricing.defaultRule) } : {}) } }, delivery: { enabled: config.delivery.enabled, free: pricing.mode === "ALL_FREE", paymentOnDelivery: config.payment.enabled, text: "", paymentText: "" }, customerFields: withDarijaCustomerFieldLabels(structuredClone(config.requiredCustomerFields)) as SellerConfig["customerFields"], interactive: { firstReplyMode: "auto", optionDisplayMode: "auto", infoMenuDisplayMode: "auto" }, receipt: { ...config.receipt, branding: { storeName: profile.displayName } }, ai: { mode: "hybrid", naturalReplyEnabled: true }, multiItemOrderFlow: structuredClone(config.orderBehavior.multiItemOrderFlow) };
      return { status: "READY", sellerConfig, productContext, conversationConfig: conversation?.config, receiptBranding: { storeName: profile.displayName, showLogo: Boolean(profile.logoObjectKey) && config.receipt.showLogo !== false } };
    } catch { return { status: "SELLER_COMMERCE_CONFIG_INVALID", readinessReason: "SELLER_COMMERCE_CONFIG_INVALID" }; }
  }
}
