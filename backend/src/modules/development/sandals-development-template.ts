import {
  CONVERSATION_CONFIG_SCHEMA_VERSION,
  type ConversationConfigurationOverride,
} from "../conversation-engine";
import type { CatalogProductInput } from "../catalog";
import { demoProductContexts } from "../agent/config/demo-product-contexts";
import { demoSellerConfigs } from "../agent/config/demo-seller-configs";
import type { ProductContext } from "../agent/config/product-context.types";
import type { SellerConfig } from "../agent/config/seller-config.types";

export const SANDALS_DEVELOPMENT_TEMPLATE_ID = "sandals-development-template";
export const SANDALS_DEVELOPMENT_PRODUCT_ID = "prod_dev_sandal_001";
export const SANDALS_DEVELOPMENT_STORE_NAME = "Sandals Development Tenant";

const HISTORICAL_SELLER_ID = "seller_demo_sandals";
const HISTORICAL_PRODUCT_ID = "prod_demo_sandal_001";

function historicalSeller(): SellerConfig {
  const config = demoSellerConfigs.find((seller) => seller.sellerId === HISTORICAL_SELLER_ID);
  if (!config) throw new Error("Historical sandals seller config is missing");
  return config;
}

function historicalProduct(): ProductContext {
  const product = demoProductContexts.find((context) => context.productId === HISTORICAL_PRODUCT_ID);
  if (!product) throw new Error("Historical sandals product context is missing");
  return product;
}

function stableValueId(optionKey: string, value: string): string {
  if (optionKey === "size" && /^[0-9]+$/u.test(value)) return `size-${value}`;
  if (optionKey === "color" && value === "أسود") return "black";
  if (optionKey === "color" && value === "وردي") return "pink";
  if (optionKey === "color" && value === "أبيض") return "white";
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "") || "value";
}

export function buildSandalsDevelopmentSellerConfig(sellerId: string): SellerConfig {
  const historical = historicalSeller();
  return structuredClone({
    ...historical,
    sellerId,
    businessName: SANDALS_DEVELOPMENT_STORE_NAME,
    receipt: {
      ...historical.receipt,
      branding: {
        ...historical.receipt.branding,
        storeName: SANDALS_DEVELOPMENT_STORE_NAME,
      },
    },
    multiItemOrderFlow: {
      enabled: true,
      runtimeMode: "guarded",
      allowedSellerIds: [sellerId],
    },
  });
}

export function buildSandalsDevelopmentRuntimeProductContext(sellerId: string): ProductContext {
  const historical = historicalProduct();
  return structuredClone({
    ...historical,
    sellerId,
    productId: SANDALS_DEVELOPMENT_PRODUCT_ID,
  });
}

export function buildSandalsDevelopmentCatalogProductInput(): CatalogProductInput {
  const product = historicalProduct();
  return {
    productId: SANDALS_DEVELOPMENT_PRODUCT_ID,
    name: product.name,
    description: product.description,
    price: { amountMinor: product.price * 100, currencyCode: product.currency },
    availability: product.active ? "available" : "unavailable",
    options: product.optionGroups.map((group, groupIndex) => ({
      optionId: group.key,
      label: group.label,
      required: group.required,
      position: group.askOrder ?? groupIndex,
      values: group.options.map((value, valueIndex) => ({
        valueId: stableValueId(group.key, value),
        label: value,
        position: valueIndex,
        isAvailable: true,
      })),
    })),
  };
}

export function buildSandalsDevelopmentProductConversationConfig(): ConversationConfigurationOverride {
  const product = historicalProduct();
  return {
    schemaVersion: CONVERSATION_CONFIG_SCHEMA_VERSION,
    locale: "ar-MA",
    productWording: {
      fullName: product.name,
      ...(product.conversationalName ? { conversationalName: product.conversationalName } : {}),
      ...(product.singularName ? { singularName: product.singularName } : {}),
      ...(product.pluralName ? { pluralName: product.pluralName } : {}),
    },
    options: product.optionGroups.map((group, groupIndex) => ({
      key: group.key,
      label: group.label,
      enabled: true,
      requirement: group.required ? "required" : "optional",
      order: group.askOrder ?? groupIndex,
      inputType: group.display,
      promptMessageKey: group.key === "size" ? "order.first_size_prompt" : "order.item_option_prompt",
      values: group.options.map((value, valueIndex) => ({
        key: stableValueId(group.key, value),
        canonicalValue: value,
        label: value,
        enabled: true,
        available: true,
        order: valueIndex,
      })),
      presentation: {
        ...(group.display === "list" ? { buttonLabel: "اختار" } : {}),
        sectionTitle: group.label,
      },
    })),
  };
}

export function buildSandalsDevelopmentSellerConversationConfig(): ConversationConfigurationOverride {
  return {
    schemaVersion: CONVERSATION_CONFIG_SCHEMA_VERSION,
    locale: "ar-MA",
  };
}

export function getHistoricalSandalsInventory(): Readonly<Record<string, unknown>> {
  const seller = historicalSeller();
  const product = historicalProduct();
  return {
    fixedEngineBehavior: [
      "Darija/Arabizi normalization",
      "Direct Answer Layer and AI intent-router routing",
      "fragmented-message session context",
      "guarded multi-item cart runtime",
      "stable interactive action id normalization",
      "same-as-previous, add, edit, remove, review, confirm/edit actions",
      "confirmed-order snapshot, persistence and receipt preparation",
    ],
    sellerConfiguration: {
      businessName: seller.businessName,
      languageStyle: seller.languageStyle,
      firstEntryPolicy: seller.firstEntryPolicy,
      deliveryPolicy: seller.deliveryPolicy,
      delivery: seller.delivery,
      customerFields: seller.customerFields,
      interactive: seller.interactive,
      receipt: seller.receipt,
      ai: seller.ai,
      multiItemOrderFlow: seller.multiItemOrderFlow,
    },
    productConfiguration: {
      productId: product.productId,
      name: product.name,
      conversationalName: product.conversationalName,
      singularName: product.singularName,
      pluralName: product.pluralName,
      description: product.description,
      price: product.price,
      currency: product.currency,
      images: product.images,
      benefits: product.benefits,
      optionGroups: product.optionGroups,
      infoMenu: product.infoMenu,
      stock: product.stock,
      offers: product.offers || [],
    },
    deliveryOrderConfiguration: {
      requiredFieldKeys: ["size", "color", "quantity", "fullName", "phone", "city", "address"],
      paymentOnDelivery: seller.delivery.paymentOnDelivery,
      deliveryPricing: seller.deliveryPolicy.pricing,
    },
    conversationTextConfiguration: {
      source: "system ar-MA conversation renderer plus product wording",
      productWording: buildSandalsDevelopmentProductConversationConfig().productWording,
    },
    legacyOnlyTestGatesNotMigrated: [
      "unknown seller fallback to seller_demo_sandals",
      "FIRST_ENTRY_LIVE_SMOKE_* seller routing",
      "WHATSAPP_CLOUD_ACCESS_TOKEN global token path",
      "hardcoded seller_demo_sandals runtime ownership",
    ],
  };
}
