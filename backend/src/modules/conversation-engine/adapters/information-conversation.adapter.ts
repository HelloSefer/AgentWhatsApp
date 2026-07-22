import type { ConversationLabelKey, ConversationMessageKey } from "../contracts/conversation-presentation.types";
import { renderConversationLabel, renderConversationMessage } from "../rendering/conversation-renderer.service";

type InformationMessageKey = Extract<ConversationMessageKey, `information.${string}`>;
type InformationLabelKey = Extract<ConversationLabelKey, `information.${string}`>;

export function informationMessage(
  key: InformationMessageKey,
  variables: Readonly<Record<string, string | number | boolean>> = {},
): string {
  return renderConversationMessage(key, variables);
}

export function informationLabel(
  key: InformationLabelKey,
  variables: Readonly<Record<string, string | number | boolean>> = {},
): string {
  return renderConversationLabel(key, variables);
}

