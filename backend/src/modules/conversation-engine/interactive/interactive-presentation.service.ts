import type { AgentReplyUiHint, AgentReplyUiHintPurpose } from "../../agent/reply/reply-renderer.types";
import type {
  ConversationAction,
  ConversationListRow,
  ConversationMessageKey,
  ConversationPresentation,
} from "../contracts/conversation-presentation.types";

const MAX_ACTION_ID_LENGTH = 200;
const MAX_BUTTON_LABEL_LENGTH = 24;
const MAX_LIST_LABEL_LENGTH = 48;
const MAX_LIST_DESCRIPTION_LENGTH = 72;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/u;

function truncate(value: string, maximumLength: number): string {
  const clean = value.replace(/[\u0000-\u001F\u007F-\u009F]/gu, "").replace(/\s+/gu, " ").trim();
  const characters = Array.from(clean);
  return characters.length <= maximumLength
    ? clean
    : `${characters.slice(0, Math.max(0, maximumLength - 1)).join("").trimEnd()}…`;
}

function validAction(action: ConversationAction): boolean {
  return (
    Boolean(action.id.trim()) &&
    Array.from(action.id).length <= MAX_ACTION_ID_LENGTH &&
    !CONTROL_CHARACTERS.test(action.id) &&
    Boolean(action.label.trim())
  );
}

export function buildConversationPresentation(input: {
  messageKey: ConversationMessageKey;
  body: string;
  interactionType: "text" | "buttons" | "list";
  title?: string;
  buttonText?: string;
  actions?: readonly ConversationAction[];
  rows?: readonly ConversationListRow[];
  fallbackText?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}): ConversationPresentation {
  const source = input.interactionType === "list"
    ? [...(input.rows || [])].filter((row) => row.enabled).sort((left, right) => left.order - right.order)
    : [...(input.actions || [])];
  const valid = source.every(validAction);
  return {
    messageKey: input.messageKey,
    locale: "ar-MA",
    body: input.body,
    interactionType: valid ? input.interactionType : "text",
    ...(input.title ? { title: input.title } : {}),
    ...(input.buttonText ? { buttonText: input.buttonText } : {}),
    ...(valid && input.actions ? { actions: input.actions.map((action) => ({ ...action })) } : {}),
    ...(valid && input.rows ? { rows: input.rows.map((row) => ({ ...row })) } : {}),
    ...(input.fallbackText ? { fallbackText: input.fallbackText } : {}),
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
  };
}

export function toAgentReplyUiHint(
  presentation: ConversationPresentation,
  purpose: AgentReplyUiHintPurpose,
): AgentReplyUiHint {
  const isButtons = presentation.interactionType === "buttons";
  const source = presentation.interactionType === "list"
    ? presentation.rows || []
    : presentation.actions || [];
  return {
    kind: presentation.interactionType === "buttons" || presentation.interactionType === "list"
      ? presentation.interactionType
      : "none",
    purpose,
    ...(presentation.title ? { title: presentation.title } : {}),
    ...(presentation.buttonText ? { buttonText: presentation.buttonText } : {}),
    body: presentation.body,
    options: source.map((action) => ({
      id: action.id,
      label: truncate(action.label, isButtons ? MAX_BUTTON_LABEL_LENGTH : MAX_LIST_LABEL_LENGTH),
      ...(action.description
        ? { value: truncate(action.description, MAX_LIST_DESCRIPTION_LENGTH) }
        : action.value !== undefined
          ? { value: truncate(action.value, MAX_LIST_DESCRIPTION_LENGTH) }
          : {}),
    })),
    previewOnly: true,
  };
}
