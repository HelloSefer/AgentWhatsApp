import type { DatabaseQueryExecutor, TenantContext } from "../../../infrastructure/database";
import type { ConversationConfigurationOverride } from "../../conversation-engine";
import type { PersistedConversationConfig } from "../domain/persisted-conversation-config.types";

export type ConversationConfigRepositoryOptions = Readonly<{
  executor?: DatabaseQueryExecutor;
}>;

export interface ConversationConfigRepository {
  getSellerOverride(tenant: TenantContext, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig | null>;
  saveSellerOverride(tenant: TenantContext, config: ConversationConfigurationOverride, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig>;
  clearSellerOverride(tenant: TenantContext, options?: ConversationConfigRepositoryOptions): Promise<void>;
  getProductOverride(tenant: TenantContext, productId: string, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig | null>;
  saveProductOverride(tenant: TenantContext, productId: string, config: ConversationConfigurationOverride, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig>;
  clearProductOverride(tenant: TenantContext, productId: string, options?: ConversationConfigRepositoryOptions): Promise<void>;
}
