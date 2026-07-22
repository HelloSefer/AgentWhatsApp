import type { ConversationConfigurationOverride } from "../../conversation-engine";

export type PersistedConversationConfig = Readonly<{
  schemaVersion: 1;
  config: ConversationConfigurationOverride;
  createdAt: Date;
  updatedAt: Date;
}>;
