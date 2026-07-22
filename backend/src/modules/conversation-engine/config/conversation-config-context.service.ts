import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvedConversationConfig } from "./conversation-config.types";

const storage = new AsyncLocalStorage<ResolvedConversationConfig>();

export function runWithConversationConfig<T>(
  config: ResolvedConversationConfig,
  callback: () => T,
): T {
  return storage.run(config, callback);
}

export function getActiveConversationConfig(): ResolvedConversationConfig | undefined {
  return storage.getStore();
}
