import type {
  ConversationConfigScope,
  ConversationConfiguration,
  ConversationConfigurationOverride,
} from "./conversation-config.types";

/** Storage boundary designed for a future PostgreSQL adapter. */
export interface ConversationConfigProvider {
  getSystemConfiguration(locale?: string): ConversationConfiguration;
  getSellerOverride(sellerId: string): ConversationConfigurationOverride | undefined;
  getProductOverride(
    sellerId: string,
    productId: string,
  ): ConversationConfigurationOverride | undefined;
  getConfigurationLayers(scope: ConversationConfigScope): Readonly<{
    system: ConversationConfiguration;
    seller?: ConversationConfigurationOverride;
    product?: ConversationConfigurationOverride;
  }>;
}
