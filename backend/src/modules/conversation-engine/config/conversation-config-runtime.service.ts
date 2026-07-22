import type { ConversationConfigProvider } from "./conversation-config-provider";
import {
  CONVERSATION_CONFIG_SCHEMA_VERSION,
  type ConversationConfigFieldSource,
  type ConversationConfigScope,
  type ConversationConfigurationOverride,
  type ConversationListConfig,
  type ConversationOptionConfig,
  type ResolvedConversationConfig,
} from "./conversation-config.types";
import { conversationConfigValidator } from "./conversation-config-validator.service";
import { inMemoryConversationConfigProvider } from "./in-memory-conversation-config.provider";

function sourceEntries(config: ConversationConfigurationOverride, source: "seller" | "product"): ConversationConfigFieldSource[] {
  return [
    ...Object.keys(config.messages || {}).map((key) => ({ path: `messages.${key}`, source } as const)),
    ...Object.keys(config.labels || {}).map((key) => ({ path: `labels.${key}`, source } as const)),
    ...Object.keys(config.productWording || {}).map((key) => ({ path: `productWording.${key}`, source } as const)),
    ...(config.options || []).map((option) => ({ path: `options.${option.key}`, source } as const)),
    ...(config.lists || []).map((list) => ({ path: `lists.${list.key}`, source } as const)),
  ];
}

export class ConversationConfigResolver {
  constructor(private readonly provider: ConversationConfigProvider = inMemoryConversationConfigProvider) {}

  resolve(scope: ConversationConfigScope): ResolvedConversationConfig {
    const layers = this.provider.getConfigurationLayers(scope);
    const messages = { ...(layers.system.messages || {}) } as ResolvedConversationConfig["messages"];
    const labels = { ...(layers.system.labels || {}) } as ResolvedConversationConfig["labels"];
    let productWording = layers.system.productWording
      ? { ...layers.system.productWording } as ResolvedConversationConfig["productWording"]
      : undefined;
    let options: ConversationOptionConfig[] = [...(layers.system.options || [])];
    let lists: ConversationListConfig[] = [...(layers.system.lists || [])];
    let optionsExplicitlyConfigured = false;
    let listsExplicitlyConfigured = false;
    const sources: ConversationConfigFieldSource[] = [
      ...Object.keys(messages).map((key) => ({ path: `messages.${key}`, source: "system" as const })),
      ...Object.keys(labels).map((key) => ({ path: `labels.${key}`, source: "system" as const })),
    ];
    const errors: ResolvedConversationConfig["errors"][number][] = [];
    const warnings: ResolvedConversationConfig["warnings"][number][] = [];
    const rejectedOverrides: string[] = [];
    const fallbackFields: string[] = [];

    for (const [source, raw] of [["seller", layers.seller], ["product", layers.product]] as const) {
      if (!raw) continue;
      const validation = conversationConfigValidator.validate(raw, source);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);
      rejectedOverrides.push(...validation.rejectedOverrides);
      fallbackFields.push(...validation.fallbackFields);
      const config = validation.normalizedConfig;
      if (!config) continue;
      Object.assign(messages, config.messages || {});
      Object.assign(labels, config.labels || {});
      if (config.productWording) {
        productWording = { ...(productWording || {}), ...config.productWording } as ResolvedConversationConfig["productWording"];
      }
      if (config.options !== undefined) {
        options = config.options.map((entry) => structuredClone(entry));
        optionsExplicitlyConfigured = true;
      }
      if (config.lists !== undefined) {
        lists = config.lists.map((entry) => structuredClone(entry));
        listsExplicitlyConfigured = true;
      }
      sources.push(...sourceEntries(config, source));
    }

    return {
      schemaVersion: CONVERSATION_CONFIG_SCHEMA_VERSION,
      locale: "ar-MA",
      messages,
      labels,
      ...(productWording && Object.keys(productWording).length === 4
        ? { productWording: productWording as NonNullable<ResolvedConversationConfig["productWording"]> }
        : {}),
      options: options.sort((left, right) => left.order - right.order),
      lists,
      optionsExplicitlyConfigured,
      listsExplicitlyConfigured,
      sources,
      errors,
      warnings,
      rejectedOverrides,
      fallbackFields,
    };
  }
}

export const conversationConfigResolver = new ConversationConfigResolver();
