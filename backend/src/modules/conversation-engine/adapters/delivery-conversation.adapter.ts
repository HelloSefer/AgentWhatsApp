import type {
  ConversationLabelKey,
  ConversationMessageKey,
  ConversationTemplateValue,
} from "../contracts/conversation-presentation.types";
import { renderConversationLabel, renderConversationMessage } from "../rendering/conversation-renderer.service";

type DeliveryMessageKey = Extract<ConversationMessageKey, `delivery.${string}` | `checkout.${string}` | `order.confirmed_success` | `order.already_confirmed`>;
type DeliveryLabelKey = Extract<ConversationLabelKey, `delivery.${string}` | `checkout.${string}`>;

export function deliveryMessage(
  key: DeliveryMessageKey,
  variables: Readonly<Record<string, ConversationTemplateValue>> = {},
): string {
  return renderConversationMessage(key, variables);
}

export function deliveryLabel(
  key: DeliveryLabelKey,
  variables: Readonly<Record<string, ConversationTemplateValue>> = {},
): string {
  return renderConversationLabel(key, variables);
}

