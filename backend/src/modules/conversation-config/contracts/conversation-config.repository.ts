import type { TenantContext } from "../../../infrastructure/database";
import type { ConversationConfigurationOverride } from "../../conversation-engine";
import type { PersistedConversationConfig } from "../domain/persisted-conversation-config.types";

export interface ConversationConfigRepository {
  getSellerOverride(tenant: TenantContext): Promise<PersistedConversationConfig | null>;
  saveSellerOverride(tenant: TenantContext, config: ConversationConfigurationOverride): Promise<PersistedConversationConfig>;
  clearSellerOverride(tenant: TenantContext): Promise<void>;
  getProductOverride(tenant: TenantContext, productId: string): Promise<PersistedConversationConfig | null>;
  saveProductOverride(tenant: TenantContext, productId: string, config: ConversationConfigurationOverride): Promise<PersistedConversationConfig>;
  clearProductOverride(tenant: TenantContext, productId: string): Promise<void>;
}
