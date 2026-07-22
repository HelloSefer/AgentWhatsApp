import { CONVERSATION_LABEL_KEYS, CONVERSATION_MESSAGE_KEYS } from "../contracts/conversation-presentation.types";
import type { ResolvedConversationConfig } from "./conversation-config.types";
import { getConversationTemplateTokenContract } from "./conversation-config-validator.service";
import { getSafeConversationOutcomeChoices } from "./conversation-safe-outcome.registry";

/** Safe editing DTO. Transport internals and executable domain objects are deliberately absent. */
export function toConversationConfigEditorDto(config: ResolvedConversationConfig) {
  const sourceMap = Object.fromEntries(config.sources.map((entry) => [entry.path, entry.source]));
  return {
    schemaVersion: config.schemaVersion,
    locale: config.locale,
    messages: CONVERSATION_MESSAGE_KEYS.map((key) => ({
      key,
      template: config.messages[key],
      allowedTokens: getConversationTemplateTokenContract()[key],
      source: sourceMap[`messages.${key}`] || "system",
    })),
    labels: CONVERSATION_LABEL_KEYS.map((key) => ({
      key,
      value: config.labels[key],
      source: sourceMap[`labels.${key}`] || "system",
    })),
    productWording: config.productWording,
    options: config.options.map((option) => ({
      key: option.key,
      label: option.label,
      enabled: option.enabled,
      requirement: option.requirement,
      order: option.order,
      inputType: option.inputType,
      promptMessageKey: option.promptMessageKey,
      presentation: option.presentation,
      values: option.values.map((value) => ({
        key: value.key,
        canonicalValue: value.canonicalValue,
        label: value.label,
        description: value.description,
        enabled: value.enabled,
        available: value.available,
        order: value.order,
        outcome: value.outcome,
      })),
      outcome: option.outcome,
      source: sourceMap[`options.${option.key}`] || "system",
    })),
    lists: config.lists.map((list) => ({
      key: list.key,
      enabled: list.enabled,
      bodyMessageKey: list.bodyMessageKey,
      openingButtonLabel: list.openingButtonLabel,
      title: list.title,
      fallbackText: list.fallbackText,
      sections: list.sections.map((section) => ({
        key: section.key,
        title: section.title,
        enabled: section.enabled,
        order: section.order,
        rows: section.rows.map(({ key, label, description, enabled, available, order, outcome }) => ({
          key,
          label,
          description,
          enabled,
          available,
          order,
          outcome,
        })),
      })),
      source: sourceMap[`lists.${list.key}`] || "system",
    })),
    safeOutcomeChoices: getSafeConversationOutcomeChoices(),
    validationConstraints: {
      messageMaxLength: 4096,
      visibleLabelMaxLength: 80,
      buttonLabelMaxLength: 24,
      rowDescriptionMaxLength: 72,
      supportedSchemaVersions: [1],
      supportedLocales: ["ar-MA"],
    },
    warnings: config.warnings,
    errors: config.errors,
    fallbackFields: config.fallbackFields,
  };
}
