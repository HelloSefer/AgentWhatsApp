import type {
  ConversationMessageKey,
  ConversationOutcomeReference,
} from "./conversation-presentation.types";

export type ConversationOptionInputType = "buttons" | "list" | "text" | "auto";
export type ConversationOptionRequirement = "required" | "optional" | "disabled";
export type ConversationSelectionMode = "single";

export type ConversationProductWording = Readonly<{
  fullName: string;
  conversationalName: string;
  singularName: string;
  pluralName: string;
}>;

export type ConversationOptionValue = Readonly<{
  key: string;
  canonicalValue: string;
  displayLabel: string;
  description?: string;
  enabled: boolean;
  order: number;
  available?: boolean;
  outcome?: ConversationOutcomeReference;
}>;

export type ConversationOptionValidation = Readonly<{
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  allowedPattern?: string;
}>;

export type ConversationProductOption = Readonly<{
  key: string;
  label: string;
  inputType: ConversationOptionInputType;
  requirement: ConversationOptionRequirement;
  enabled: boolean;
  order: number;
  values: readonly ConversationOptionValue[];
  validation?: ConversationOptionValidation;
  selectionMode: ConversationSelectionMode;
  promptKey: ConversationMessageKey;
  listButtonLabel?: string;
  listTitle?: string;
  sectionTitle?: string;
  fallbackText?: string;
  currentValueMarker?: string;
  outcome?: ConversationOutcomeReference;
  actionNamespace: string;
}>;
