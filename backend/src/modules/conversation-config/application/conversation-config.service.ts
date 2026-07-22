import type { TenantContext } from "../../../infrastructure/database";
import type { ConversationConfigurationOverride } from "../../conversation-engine";
import type { ConversationConfigRepository } from "../contracts/conversation-config.repository";
import type { PersistedConversationConfig } from "../domain/persisted-conversation-config.types";
import { validateConversationConfigOverride, validateConversationConfigProductId } from "../domain/conversation-config.validation";

export class ConversationConfigService {
  constructor(private readonly repository: ConversationConfigRepository) {}

  getSellerOverride(tenant: TenantContext): Promise<PersistedConversationConfig | null> {
    return this.repository.getSellerOverride(tenant);
  }

  saveSellerOverride(tenant: TenantContext, config: unknown): Promise<PersistedConversationConfig> {
    return this.repository.saveSellerOverride(tenant, validateConversationConfigOverride(config));
  }

  clearSellerOverride(tenant: TenantContext): Promise<void> {
    return this.repository.clearSellerOverride(tenant);
  }

  getProductOverride(tenant: TenantContext, productId: unknown): Promise<PersistedConversationConfig | null> {
    return this.repository.getProductOverride(tenant, validateConversationConfigProductId(productId));
  }

  saveProductOverride(tenant: TenantContext, productId: unknown, config: unknown): Promise<PersistedConversationConfig> {
    return this.repository.saveProductOverride(tenant, validateConversationConfigProductId(productId), validateConversationConfigOverride(config));
  }

  clearProductOverride(tenant: TenantContext, productId: unknown): Promise<void> {
    return this.repository.clearProductOverride(tenant, validateConversationConfigProductId(productId));
  }
}
