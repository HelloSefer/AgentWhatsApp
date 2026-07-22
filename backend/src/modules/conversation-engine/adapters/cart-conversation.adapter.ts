import type { ConversationLabelKey, ConversationMessageKey } from "../contracts/conversation-presentation.types";
import { renderConversationLabel, renderConversationMessage } from "../rendering/conversation-renderer.service";

type CartMessageKey = Extract<ConversationMessageKey, `cart.${string}`>;
type CartLabelKey = Extract<ConversationLabelKey, `cart.${string}`>;

export function cartMessage(
  key: CartMessageKey,
  variables: Readonly<Record<string, string | number | boolean>> = {},
): string {
  return renderConversationMessage(key, variables);
}

export function cartLabel(
  key: CartLabelKey,
  variables: Readonly<Record<string, string | number | boolean>> = {},
): string {
  return renderConversationLabel(key, variables);
}

