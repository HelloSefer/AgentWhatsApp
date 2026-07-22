import {
  ConversationConfigCorruptedError,
  ConversationConfigPersistenceError,
  ConversationConfigProductNotFoundError,
  ConversationConfigSellerNotFoundError,
  ConversationConfigService,
} from "../../modules/conversation-config";
import {
  DatabaseConfigurationError,
  DatabaseConnectionError,
  DatabaseQueryError,
  InvalidTenantContextError,
  createTenantContext,
} from "../../infrastructure/database";
import {
  ConversationConfigResolver,
  type ConversationConfigProvider,
  type ConversationConfigScope,
  type ConversationConfiguration,
  type ConversationConfigurationOverride,
  type ResolvedConversationConfig,
  inMemoryConversationConfigProvider,
} from "../../modules/conversation-engine";
import type { RuntimeReadFallbackReason, RuntimeReadSource } from "./runtime-read-fallback.types";
import type { RuntimeReadMode } from "./runtime-read-mode";

export type RuntimeConversationConfigReadResult = Readonly<{
  config: ResolvedConversationConfig;
  source: RuntimeReadSource;
  fallbackReason?: RuntimeReadFallbackReason;
}>;

class LoadedConversationConfigProvider implements ConversationConfigProvider {
  constructor(
    private readonly seller?: ConversationConfigurationOverride,
    private readonly product?: ConversationConfigurationOverride,
  ) {}

  getSystemConfiguration(locale?: string): ConversationConfiguration {
    return inMemoryConversationConfigProvider.getSystemConfiguration(locale);
  }

  getSellerOverride(_sellerId: string): ConversationConfigurationOverride | undefined {
    return this.seller
      ? structuredClone(this.seller)
      : inMemoryConversationConfigProvider.getSellerOverride(_sellerId);
  }

  getProductOverride(sellerId: string, productId: string): ConversationConfigurationOverride | undefined {
    return this.product
      ? structuredClone(this.product)
      : inMemoryConversationConfigProvider.getProductOverride(sellerId, productId);
  }

  getConfigurationLayers(scope: ConversationConfigScope) {
    return {
      system: this.getSystemConfiguration(scope.locale),
      ...(this.seller ? { seller: this.getSellerOverride(scope.sellerId) } : {}),
      ...(scope.productId && this.product ? { product: this.getProductOverride(scope.sellerId, scope.productId) } : {}),
    };
  }
}

function isSafeConfigReadError(error: unknown): boolean {
  return error instanceof InvalidTenantContextError
    || error instanceof DatabaseConfigurationError
    || error instanceof DatabaseConnectionError
    || error instanceof DatabaseQueryError
    || error instanceof ConversationConfigCorruptedError
    || error instanceof ConversationConfigPersistenceError
    || error instanceof ConversationConfigSellerNotFoundError
    || error instanceof ConversationConfigProductNotFoundError;
}

export class RuntimeConversationConfigReader {
  constructor(
    private readonly conversationConfigService: ConversationConfigService,
    private readonly mode: RuntimeReadMode,
    private readonly legacyResolver = new ConversationConfigResolver(),
  ) {}

  async resolve(scope: ConversationConfigScope): Promise<RuntimeConversationConfigReadResult> {
    if (this.mode === "disabled") {
      return { config: this.legacyResolver.resolve(scope), source: "legacy", fallbackReason: "disabled" };
    }

    try {
      const tenant = createTenantContext(scope.sellerId);
      const seller = await this.conversationConfigService.getSellerOverride(tenant);
      const product = scope.productId
        ? await this.conversationConfigService.getProductOverride(tenant, scope.productId)
        : null;
      const resolver = new ConversationConfigResolver(
        new LoadedConversationConfigProvider(seller?.config, product?.config),
      );
      return { config: resolver.resolve(scope), source: "persistence" };
    } catch (error) {
      if (!isSafeConfigReadError(error)) throw error;
      return {
        config: this.legacyResolver.resolve(scope),
        source: "legacy",
        fallbackReason: error instanceof InvalidTenantContextError ? "invalid_tenant" : "database_unavailable",
      };
    }
  }
}
