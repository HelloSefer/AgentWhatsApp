import {
  CONVERSATION_MESSAGE_KEYS,
  CONVERSATION_PRESENTATION_KEYS,
  type ConversationMessageKey,
  type ConversationOutcomeReference,
  type ConversationPresentationKey,
} from "../contracts/conversation-presentation.types";

export const CONVERSATION_DOMAIN_ACTION_KEYS = [
  "START_ORDER",
  "SHOW_MORE_INFORMATION",
  "CONTINUE_ORDER",
  "ADD_ITEM",
  "EDIT_CART",
  "REMOVE_ITEM",
  "CONFIRM_ORDER",
  "EDIT_ORDER",
  "EDIT_DELIVERY",
  "RECOVER",
] as const;

export type ConversationDomainActionKey = (typeof CONVERSATION_DOMAIN_ACTION_KEYS)[number];

const messageKeys = new Set<string>(CONVERSATION_MESSAGE_KEYS);
const presentationKeys = new Set<string>(CONVERSATION_PRESENTATION_KEYS);
const domainActionKeys = new Set<string>(CONVERSATION_DOMAIN_ACTION_KEYS);

export function isRegisteredConversationMessageKey(value: unknown): value is ConversationMessageKey {
  return typeof value === "string" && messageKeys.has(value);
}

export function isRegisteredConversationPresentationKey(value: unknown): value is ConversationPresentationKey {
  return typeof value === "string" && presentationKeys.has(value);
}

export function isRegisteredConversationDomainActionKey(value: unknown): value is ConversationDomainActionKey {
  return typeof value === "string" && domainActionKeys.has(value);
}

export function validateConversationOutcomeReference(input: {
  outcome: ConversationOutcomeReference;
  path: string;
  optionKeys: ReadonlySet<string>;
  textInputOptionKeys: ReadonlySet<string>;
}): readonly { path: string; code: string; message: string }[] {
  const issues: { path: string; code: string; message: string }[] = [];
  const { outcome, path } = input;
  if (outcome.responseMessageKey && !isRegisteredConversationMessageKey(outcome.responseMessageKey)) {
    issues.push({ path: `${path}.responseMessageKey`, code: "UNREGISTERED_MESSAGE_KEY", message: "The response message key is not registered." });
  }
  if (outcome.nextPresentationKey && !isRegisteredConversationPresentationKey(outcome.nextPresentationKey)) {
    issues.push({ path: `${path}.nextPresentationKey`, code: "UNREGISTERED_PRESENTATION_KEY", message: "The next presentation key is not registered." });
  }
  if (outcome.domainActionKey && !isRegisteredConversationDomainActionKey(outcome.domainActionKey)) {
    issues.push({ path: `${path}.domainActionKey`, code: "UNREGISTERED_DOMAIN_ACTION", message: "The domain action key is not registered." });
  }
  if (outcome.requestConfiguredOptionKey && !input.optionKeys.has(outcome.requestConfiguredOptionKey)) {
    issues.push({ path: `${path}.requestConfiguredOptionKey`, code: "UNKNOWN_OPTION_REFERENCE", message: "The configured option reference does not exist." });
  }
  if (outcome.requestTextInputKey && !input.textInputOptionKeys.has(outcome.requestTextInputKey)) {
    issues.push({ path: `${path}.requestTextInputKey`, code: "INVALID_TEXT_INPUT_REFERENCE", message: "The text input reference is not a configured text option." });
  }
  return issues;
}

export function getSafeConversationOutcomeChoices() {
  return {
    messageKeys: [...CONVERSATION_MESSAGE_KEYS],
    presentationKeys: [...CONVERSATION_PRESENTATION_KEYS],
    domainActionKeys: [...CONVERSATION_DOMAIN_ACTION_KEYS],
  } as const;
}
