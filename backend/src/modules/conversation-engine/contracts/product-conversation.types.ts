import type { ConversationMessageKey } from "./conversation-presentation.types";

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
  canonicalValue: string;
  displayLabel: string;
  enabled: boolean;
  order: number;
  available?: boolean;
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
  actionNamespace: string;
}>;
