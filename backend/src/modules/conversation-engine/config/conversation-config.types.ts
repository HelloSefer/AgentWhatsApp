import type {
  ConversationLabelKey,
  ConversationLocale,
  ConversationMessageKey,
  ConversationOutcomeReference,
} from "../contracts/conversation-presentation.types";
import type {
  ConversationOptionInputType,
  ConversationOptionRequirement,
  ConversationProductWording,
} from "../contracts/product-conversation.types";

export const CONVERSATION_CONFIG_SCHEMA_VERSION = 1 as const;
export type ConversationConfigSchemaVersion = typeof CONVERSATION_CONFIG_SCHEMA_VERSION;

export type ConversationConfigSource = "system" | "seller" | "product";
export type ConversationValidationSeverity = "error" | "warning";

export type ConversationValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
  severity: ConversationValidationSeverity;
}>;

export type ConversationOptionValueConfig = Readonly<{
  key: string;
  canonicalValue: string;
  label: string;
  description?: string;
  enabled: boolean;
  available: boolean;
  order: number;
  outcome?: ConversationOutcomeReference;
}>;

export type ConversationOptionPresentationConfig = Readonly<{
  title?: string;
  sectionTitle?: string;
  buttonLabel?: string;
  fallbackText?: string;
  currentValueMarker?: string;
}>;

export type ConversationOptionConfig = Readonly<{
  key: string;
  label: string;
  enabled: boolean;
  requirement: ConversationOptionRequirement;
  order: number;
  inputType: ConversationOptionInputType;
  promptMessageKey: ConversationMessageKey;
  values: readonly ConversationOptionValueConfig[];
  presentation?: ConversationOptionPresentationConfig;
  validation?: Readonly<{
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
    allowedPattern?: string;
  }>;
  outcome?: ConversationOutcomeReference;
}>;

export type ConversationListRowConfig = Readonly<{
  key: string;
  label: string;
  description?: string;
  enabled: boolean;
  available: boolean;
  order: number;
  outcome?: ConversationOutcomeReference;
}>;

export type ConversationListSectionConfig = Readonly<{
  key: string;
  title?: string;
  enabled: boolean;
  order: number;
  rows: readonly ConversationListRowConfig[];
}>;

export type ConversationListConfig = Readonly<{
  key: string;
  enabled: boolean;
  bodyMessageKey: ConversationMessageKey;
  openingButtonLabel: string;
  title?: string;
  fallbackText?: string;
  sections: readonly ConversationListSectionConfig[];
  outcome?: ConversationOutcomeReference;
}>;

/** Presentation-only configuration. It contains no executable services or transport data. */
export type ConversationConfiguration = Readonly<{
  schemaVersion: ConversationConfigSchemaVersion;
  locale: ConversationLocale;
  messages?: Readonly<Partial<Record<ConversationMessageKey, string>>>;
  labels?: Readonly<Partial<Record<ConversationLabelKey, string>>>;
  productWording?: Readonly<Partial<ConversationProductWording>>;
  options?: readonly ConversationOptionConfig[];
  lists?: readonly ConversationListConfig[];
}>;

export type ConversationConfigurationOverride = Readonly<{
  schemaVersion: number;
  locale?: ConversationLocale;
  messages?: Readonly<Partial<Record<ConversationMessageKey, string>>>;
  labels?: Readonly<Partial<Record<ConversationLabelKey, string>>>;
  productWording?: Readonly<Partial<ConversationProductWording>>;
  options?: readonly ConversationOptionConfig[];
  lists?: readonly ConversationListConfig[];
}>;

export type ConversationConfigValidationResult = Readonly<{
  valid: boolean;
  errors: readonly ConversationValidationIssue[];
  warnings: readonly ConversationValidationIssue[];
  normalizedConfig?: ConversationConfigurationOverride;
  rejectedOverrides: readonly string[];
  fallbackFields: readonly string[];
}>;

export type ConversationConfigFieldSource = Readonly<{
  path: string;
  source: ConversationConfigSource;
}>;

export type ResolvedConversationConfig = Readonly<{
  schemaVersion: ConversationConfigSchemaVersion;
  locale: ConversationLocale;
  messages: Readonly<Record<ConversationMessageKey, string>>;
  labels: Readonly<Record<ConversationLabelKey, string>>;
  productWording?: ConversationProductWording;
  options: readonly ConversationOptionConfig[];
  lists: readonly ConversationListConfig[];
  optionsExplicitlyConfigured: boolean;
  listsExplicitlyConfigured: boolean;
  sources: readonly ConversationConfigFieldSource[];
  errors: readonly ConversationValidationIssue[];
  warnings: readonly ConversationValidationIssue[];
  rejectedOverrides: readonly string[];
  fallbackFields: readonly string[];
}>;

export type ConversationConfigScope = Readonly<{
  sellerId: string;
  productId?: string;
  locale?: ConversationLocale;
}>;
