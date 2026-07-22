import type { ConversationMessageKey } from "../contracts/conversation-presentation.types";
import { renderConversationMessage } from "../rendering/conversation-renderer.service";

type SalesMessageKey = Extract<ConversationMessageKey, `sales.${string}`>;

export function salesMessage(
  key: SalesMessageKey,
  variables: Readonly<Record<string, string | number | boolean>> = {},
): string {
  return renderConversationMessage(key, variables);
}
