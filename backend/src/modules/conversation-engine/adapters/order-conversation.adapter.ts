import type { ConversationLabelKey, ConversationMessageKey } from "../contracts/conversation-presentation.types";
import { renderConversationLabel, renderConversationMessage } from "../rendering/conversation-renderer.service";

type OrderMessageKey = Extract<ConversationMessageKey, `order.${string}` | `error.${string}`>;
type OrderLabelKey = Extract<ConversationLabelKey, `order.${string}`>;

export function orderMessage(
  key: OrderMessageKey,
  variables: Readonly<Record<string, string | number | boolean>> = {},
): string {
  return renderConversationMessage(key, variables);
}

export function orderLabel(
  key: OrderLabelKey,
  variables: Readonly<Record<string, string | number | boolean>> = {},
): string {
  return renderConversationLabel(key, variables);
}

