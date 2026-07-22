import { AR_MA_LABELS, AR_MA_MESSAGES } from "../locales/ar-MA";
import type { ConversationConfigProvider } from "./conversation-config-provider";
import {
  CONVERSATION_CONFIG_SCHEMA_VERSION,
  type ConversationConfigScope,
  type ConversationConfiguration,
  type ConversationConfigurationOverride,
} from "./conversation-config.types";

const SYSTEM_AR_MA_CONFIG: ConversationConfiguration = Object.freeze({
  schemaVersion: CONVERSATION_CONFIG_SCHEMA_VERSION,
  locale: "ar-MA",
  messages: AR_MA_MESSAGES,
  labels: AR_MA_LABELS,
  options: [],
  lists: [],
});

function productScopeKey(sellerId: string, productId: string): string {
  return `${sellerId.trim()}::${productId.trim()}`;
}

/** In-memory adapter used now; a database adapter can implement the same provider later. */
export class InMemoryConversationConfigProvider implements ConversationConfigProvider {
  private readonly sellerOverrides = new Map<string, ConversationConfigurationOverride>();
  private readonly productOverrides = new Map<string, ConversationConfigurationOverride>();

  constructor(input?: {
    sellerOverrides?: Readonly<Record<string, ConversationConfigurationOverride>>;
    productOverrides?: Readonly<Record<string, ConversationConfigurationOverride>>;
  }) {
    for (const [sellerId, config] of Object.entries(input?.sellerOverrides || {})) {
      this.sellerOverrides.set(sellerId.trim(), structuredClone(config));
    }
    for (const [scope, config] of Object.entries(input?.productOverrides || {})) {
      this.productOverrides.set(scope.trim(), structuredClone(config));
    }
  }

  getSystemConfiguration(_locale?: string): ConversationConfiguration {
    return structuredClone(SYSTEM_AR_MA_CONFIG);
  }

  getSellerOverride(sellerId: string): ConversationConfigurationOverride | undefined {
    const config = this.sellerOverrides.get(sellerId.trim());
    return config ? structuredClone(config) : undefined;
  }

  getProductOverride(sellerId: string, productId: string): ConversationConfigurationOverride | undefined {
    const config = this.productOverrides.get(productScopeKey(sellerId, productId));
    return config ? structuredClone(config) : undefined;
  }

  getConfigurationLayers(scope: ConversationConfigScope) {
    const system = this.getSystemConfiguration(scope.locale);
    const seller = this.getSellerOverride(scope.sellerId);
    const product = scope.productId
      ? this.getProductOverride(scope.sellerId, scope.productId)
      : undefined;
    return {
      system,
      ...(seller ? { seller } : {}),
      ...(product ? { product } : {}),
    };
  }

  setSellerOverride(sellerId: string, config: ConversationConfigurationOverride): void {
    this.sellerOverrides.set(sellerId.trim(), structuredClone(config));
  }

  setProductOverride(sellerId: string, productId: string, config: ConversationConfigurationOverride): void {
    this.productOverrides.set(productScopeKey(sellerId, productId), structuredClone(config));
  }

  clear(): void {
    this.sellerOverrides.clear();
    this.productOverrides.clear();
  }
}

export const inMemoryConversationConfigProvider = new InMemoryConversationConfigProvider();
