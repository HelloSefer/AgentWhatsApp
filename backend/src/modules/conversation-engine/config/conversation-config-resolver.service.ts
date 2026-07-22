import {
  CONVERSATION_LABEL_KEYS,
  CONVERSATION_MESSAGE_KEYS,
  type ConversationLabelKey,
  type ConversationMessageKey,
} from "../contracts/conversation-presentation.types";
import { AR_MA_LABELS, AR_MA_MESSAGES } from "../locales/ar-MA";
import type {
  ConversationOverrideResolutionInput,
  ConversationOverrideResolutionResult,
  ConversationPresentationOverrides,
} from "./conversation-overrides.types";

const MAX_MESSAGE_LENGTH = 4096;
const MAX_LABEL_LENGTH = 80;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const TOKEN_PATTERN = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

function tokens(value: string): string[] {
  return [...value.matchAll(TOKEN_PATTERN)].map((match) => match[1]).sort();
}

function hasSameTokens(candidate: string, fallback: string): boolean {
  return tokens(candidate).join("|") === tokens(fallback).join("|");
}

function validText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    Array.from(value).length <= maximumLength &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function applyMessageOverrides(
  target: Record<ConversationMessageKey, string>,
  overrides: ConversationPresentationOverrides | undefined,
  source: "seller" | "product",
  warnings: string[],
): void {
  for (const key of CONVERSATION_MESSAGE_KEYS) {
    const candidate = overrides?.messages?.[key];
    if (candidate === undefined) continue;
    if (!validText(candidate, MAX_MESSAGE_LENGTH) || !hasSameTokens(candidate, AR_MA_MESSAGES[key])) {
      warnings.push(`${source}_message_override_rejected:${key}`);
      continue;
    }
    target[key] = candidate;
  }
}

function applyLabelOverrides(
  target: Record<ConversationLabelKey, string>,
  overrides: ConversationPresentationOverrides | undefined,
  source: "seller" | "product",
  warnings: string[],
): void {
  for (const key of CONVERSATION_LABEL_KEYS) {
    const candidate = overrides?.labels?.[key];
    if (candidate === undefined) continue;
    if (!validText(candidate, MAX_LABEL_LENGTH) || !hasSameTokens(candidate, AR_MA_LABELS[key])) {
      warnings.push(`${source}_label_override_rejected:${key}`);
      continue;
    }
    target[key] = candidate;
  }
}

function mergeFreeformVisibleMap(
  sellerValues: Readonly<Record<string, string>> | undefined,
  productValues: Readonly<Record<string, string>> | undefined,
  warnings: string[],
  field: string,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [source, values] of [["seller", sellerValues], ["product", productValues]] as const) {
    for (const [key, value] of Object.entries(values || {})) {
      if (!key.trim() || !validText(value, MAX_LABEL_LENGTH)) {
        warnings.push(`${source}_${field}_override_rejected:${key}`);
        continue;
      }
      result[key] = value;
    }
  }
  return result;
}

/** Resolves presentation fields only. Action IDs and business data are not accepted inputs. */
export function resolveConversationConfig(
  input: ConversationOverrideResolutionInput = {},
): ConversationOverrideResolutionResult {
  const warnings: string[] = [];
  const locale = input.locale === "ar-MA" ? input.locale : "ar-MA";
  if (input.locale && input.locale !== "ar-MA") warnings.push("unsupported_locale_fallback:ar-MA");

  const messages = { ...AR_MA_MESSAGES };
  const labels = { ...AR_MA_LABELS };
  applyMessageOverrides(messages, input.sellerOverrides, "seller", warnings);
  applyMessageOverrides(messages, input.productOverrides, "product", warnings);
  applyLabelOverrides(labels, input.sellerOverrides, "seller", warnings);
  applyLabelOverrides(labels, input.productOverrides, "product", warnings);

  return {
    locale,
    messages,
    labels,
    listTitles: mergeFreeformVisibleMap(
      input.sellerOverrides?.listTitles,
      input.productOverrides?.listTitles,
      warnings,
      "list_title",
    ),
    listButtonLabels: mergeFreeformVisibleMap(
      input.sellerOverrides?.listButtonLabels,
      input.productOverrides?.listButtonLabels,
      warnings,
      "list_button_label",
    ),
    rowLabels: mergeFreeformVisibleMap(
      input.sellerOverrides?.rowLabels,
      input.productOverrides?.rowLabels,
      warnings,
      "row_label",
    ),
    rowDescriptions: mergeFreeformVisibleMap(
      input.sellerOverrides?.rowDescriptions,
      input.productOverrides?.rowDescriptions,
      warnings,
      "row_description",
    ),
    warnings,
  };
}

