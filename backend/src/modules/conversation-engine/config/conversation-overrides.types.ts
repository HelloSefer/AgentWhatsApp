import type {
  ConversationLabelKey,
  ConversationLocale,
  ConversationMessageKey,
} from "../contracts/conversation-presentation.types";

/** Customer-visible fields only. Internal action IDs and domain semantics are absent by design. */
export type ConversationPresentationOverrides = Readonly<{
  locale?: ConversationLocale;
  messages?: Readonly<Partial<Record<ConversationMessageKey, string>>>;
  labels?: Readonly<Partial<Record<ConversationLabelKey, string>>>;
  listTitles?: Readonly<Record<string, string>>;
  listButtonLabels?: Readonly<Record<string, string>>;
  rowLabels?: Readonly<Record<string, string>>;
  rowDescriptions?: Readonly<Record<string, string>>;
}>;

export type ConversationOverrideResolutionInput = Readonly<{
  locale?: ConversationLocale;
  sellerOverrides?: ConversationPresentationOverrides;
  productOverrides?: ConversationPresentationOverrides;
}>;

export type ConversationOverrideResolutionResult = Readonly<{
  locale: ConversationLocale;
  messages: Readonly<Record<ConversationMessageKey, string>>;
  labels: Readonly<Record<ConversationLabelKey, string>>;
  listTitles: Readonly<Record<string, string>>;
  listButtonLabels: Readonly<Record<string, string>>;
  rowLabels: Readonly<Record<string, string>>;
  rowDescriptions: Readonly<Record<string, string>>;
  warnings: readonly string[];
}>;

