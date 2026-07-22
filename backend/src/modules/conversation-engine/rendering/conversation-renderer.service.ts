import type {
  ConversationLabelKey,
  ConversationMessageKey,
  ConversationTemplateValue,
  SafeConversationFragment,
} from "../contracts/conversation-presentation.types";
import { resolveConversationConfig } from "../config/conversation-config-resolver.service";
import type { ConversationOverrideResolutionInput } from "../config/conversation-overrides.types";

const TOKEN_PATTERN = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

function safeInlineValue(value: ConversationTemplateValue): string {
  return String(value)
    .replace(CONTROL_CHARACTERS, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function composeConversationFragment(
  parts: readonly string[],
  separator = "\n",
): SafeConversationFragment {
  return parts
    .map((part) => String(part).replace(CONTROL_CHARACTERS, "").trim())
    .filter(Boolean)
    .join(separator) as SafeConversationFragment;
}

function renderTemplate(
  template: string,
  variables: Readonly<Record<string, ConversationTemplateValue>>,
): string | undefined {
  let missing = false;
  const rendered = template.replace(TOKEN_PATTERN, (_token, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      missing = true;
      return "";
    }
    const value = variables[name];
    return typeof value === "string" && value.includes("\n")
      ? String(value).replace(CONTROL_CHARACTERS, "").trim()
      : safeInlineValue(value);
  });
  return missing ? undefined : rendered.trim();
}

export function renderConversationMessage(
  key: ConversationMessageKey,
  variables: Readonly<Record<string, ConversationTemplateValue>> = {},
  resolution: ConversationOverrideResolutionInput = {},
): string {
  const config = resolveConversationConfig(resolution);
  return renderTemplate(config.messages[key], variables)
    || renderTemplate(resolveConversationConfig().messages[key], variables)
    || resolveConversationConfig().messages["error.recovery"];
}

export function renderConversationLabel(
  key: ConversationLabelKey,
  variables: Readonly<Record<string, ConversationTemplateValue>> = {},
  resolution: ConversationOverrideResolutionInput = {},
): string {
  const config = resolveConversationConfig(resolution);
  return renderTemplate(config.labels[key], variables)
    || renderTemplate(resolveConversationConfig().labels[key], variables)
    || key;
}

