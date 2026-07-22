import { CONVERSATION_CONFIG_SCHEMA_VERSION, conversationConfigValidator, type ConversationConfigurationOverride } from "../../../conversation-engine";
import { ConversationConfigCorruptedError } from "../../domain/conversation-config.errors";
import type { PersistedConversationConfig } from "../../domain/persisted-conversation-config.types";

export type ConversationConfigRow = Readonly<{
  schema_version: number;
  config_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}>;

function parseJsonObject(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new ConversationConfigCorruptedError();
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConversationConfigCorruptedError();
  return value;
}

export function mapPersistedConversationConfig(row: ConversationConfigRow): PersistedConversationConfig {
  if (row.schema_version !== CONVERSATION_CONFIG_SCHEMA_VERSION) throw new ConversationConfigCorruptedError();
  const validation = conversationConfigValidator.validate(parseJsonObject(row.config_json), "persistedConversationConfig");
  if (!validation.valid || !validation.normalizedConfig || validation.normalizedConfig.schemaVersion !== row.schema_version) {
    throw new ConversationConfigCorruptedError();
  }
  const createdAt = new Date(row.created_at);
  const updatedAt = new Date(row.updated_at);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) throw new ConversationConfigCorruptedError();
  return {
    schemaVersion: CONVERSATION_CONFIG_SCHEMA_VERSION,
    config: structuredClone(validation.normalizedConfig as ConversationConfigurationOverride),
    createdAt,
    updatedAt,
  };
}
