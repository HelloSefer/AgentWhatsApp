import { CONVERSATION_CONFIG_SCHEMA_VERSION, conversationConfigValidator, type ConversationConfigurationOverride } from "../../conversation-engine";
import { ConversationConfigValidationError } from "./conversation-config.errors";

export const CONVERSATION_CONFIG_PRODUCT_ID_MAX_LENGTH = 128;

export function validateConversationConfigOverride(value: unknown): ConversationConfigurationOverride {
  const validation = conversationConfigValidator.validate(value, "conversationConfig");
  if (!validation.valid || !validation.normalizedConfig) throw new ConversationConfigValidationError();
  if (validation.normalizedConfig.schemaVersion !== CONVERSATION_CONFIG_SCHEMA_VERSION) throw new ConversationConfigValidationError();
  return structuredClone(validation.normalizedConfig);
}

export function validateConversationConfigProductId(value: unknown): string {
  if (typeof value !== "string") throw new ConversationConfigValidationError();
  const productId = value.trim();
  if (!productId || productId.length > CONVERSATION_CONFIG_PRODUCT_ID_MAX_LENGTH) throw new ConversationConfigValidationError();
  return productId;
}
