import type { ConversationPresentation } from "../contracts/conversation-presentation.types";
import type {
  ConversationListConfig,
  ConversationOptionConfig,
  ResolvedConversationConfig,
} from "../config/conversation-config.types";
import { runWithConversationConfig } from "../config/conversation-config-context.service";
import { renderConversationMessage } from "../rendering/conversation-renderer.service";
import { buildConversationPresentation } from "./interactive-presentation.service";

const BUTTON_LIMIT = 3;
const SAFE_ACTION_SEGMENT = /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/;

function safeActionId(namespace: string, ...segments: string[]): string | undefined {
  if (![namespace, ...segments].every((segment) => SAFE_ACTION_SEGMENT.test(segment))) return undefined;
  const id = [namespace, ...segments].join(":");
  return Array.from(id).length <= 200 ? id : undefined;
}

export function buildConfiguredOptionPresentation(input: {
  option: ConversationOptionConfig;
  config: ResolvedConversationConfig;
  currentValueKey?: string;
  actionNamespace?: string;
}): ConversationPresentation {
  return runWithConversationConfig(input.config, () => {
    const body = renderConversationMessage(input.option.promptMessageKey, {
      optionLabel: input.option.label,
      selectedOptionLabel: input.option.label,
      selectedOptionValue: input.currentValueKey || "",
    });
    const values = input.option.values
      .filter((value) => value.enabled && value.available)
      .sort((left, right) => left.order - right.order);
    const namespace = input.actionNamespace || "cart_item_option";
    const rows = values.flatMap((value, order) => {
      const id = safeActionId(namespace, input.option.key, value.key);
      if (!id) return [];
      const current = value.key === input.currentValueKey;
      const marker = input.option.presentation?.currentValueMarker || "الحالي";
      return [{
        id,
        label: current ? `${value.label} — ${marker}` : value.label,
        value: value.canonicalValue,
        ...(value.description ? { description: value.description } : {}),
        order,
        enabled: true,
        available: true,
        current,
        ...(value.outcome ? { outcome: value.outcome } : {}),
      }];
    });
    if (!rows.length || input.option.inputType === "text") {
      return buildConversationPresentation({
        messageKey: input.option.promptMessageKey,
        body: input.option.presentation?.fallbackText || body,
        interactionType: "text",
        fallbackText: input.option.presentation?.fallbackText || body,
      });
    }
    const useButtons = input.option.inputType === "buttons"
      || (input.option.inputType === "auto" && rows.length <= BUTTON_LIMIT);
    return buildConversationPresentation({
      messageKey: input.option.promptMessageKey,
      body,
      interactionType: useButtons ? "buttons" : "list",
      ...(input.option.presentation?.title ? { title: input.option.presentation.title } : {}),
      ...(!useButtons && input.option.presentation?.buttonLabel
        ? { buttonText: input.option.presentation.buttonLabel }
        : {}),
      ...(useButtons ? { actions: rows } : { rows }),
      fallbackText: input.option.presentation?.fallbackText
        || [body, ...rows.map((row) => `- ${row.label}`)].join("\n"),
      metadata: { optionKey: input.option.key },
    });
  });
}

export function buildConfiguredListPresentation(input: {
  list: ConversationListConfig;
  config: ResolvedConversationConfig;
}): ConversationPresentation {
  return runWithConversationConfig(input.config, () => {
    const body = renderConversationMessage(input.list.bodyMessageKey);
    const sections = input.list.sections
      .filter((section) => section.enabled)
      .sort((left, right) => left.order - right.order)
      .map((section) => ({
        key: section.key,
        ...(section.title ? { title: section.title } : {}),
        order: section.order,
        rows: section.rows
          .filter((row) => row.enabled && row.available)
          .sort((left, right) => left.order - right.order)
          .flatMap((row) => {
            const id = safeActionId("conversation_list", input.list.key, section.key, row.key);
            return id ? [{
              id,
              label: row.label,
              ...(row.description ? { description: row.description } : {}),
              order: row.order,
              enabled: true,
              available: true,
              ...(row.outcome ? { outcome: row.outcome } : {}),
            }] : [];
          }),
      }));
    const rows = sections.flatMap((section) => section.rows);
    return buildConversationPresentation({
      messageKey: input.list.bodyMessageKey,
      body,
      interactionType: input.list.enabled && rows.length ? "list" : "text",
      ...(input.list.title ? { title: input.list.title } : {}),
      buttonText: input.list.openingButtonLabel,
      sections,
      fallbackText: input.list.fallbackText || [body, ...rows.map((row) => `- ${row.label}`)].join("\n"),
      metadata: { listKey: input.list.key },
    });
  });
}
