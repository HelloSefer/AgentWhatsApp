import type { ConversationLabelKey } from "../contracts/conversation-presentation.types";
import { renderConversationLabel } from "../rendering/conversation-renderer.service";

type CommonLabelKey = Extract<ConversationLabelKey, `common.${string}`>;

export function commonLabel(key: CommonLabelKey): string {
  return renderConversationLabel(key);
}

