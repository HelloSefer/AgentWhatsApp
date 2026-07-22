import {
  CONVERSATION_LABEL_KEYS,
  CONVERSATION_MESSAGE_KEYS,
  type ConversationLabelKey,
  type ConversationMessageKey,
  type ConversationOutcomeReference,
} from "../contracts/conversation-presentation.types";
import { AR_MA_LABELS, AR_MA_MESSAGES } from "../locales/ar-MA";
import {
  CONVERSATION_CONFIG_SCHEMA_VERSION,
  type ConversationConfigValidationResult,
  type ConversationConfigurationOverride,
  type ConversationListConfig,
  type ConversationListRowConfig,
  type ConversationListSectionConfig,
  type ConversationOptionConfig,
  type ConversationOptionValueConfig,
  type ConversationValidationIssue,
} from "./conversation-config.types";
import { validateConversationOutcomeReference } from "./conversation-safe-outcome.registry";

const MESSAGE_MAX_LENGTH = 4096;
const LABEL_MAX_LENGTH = 80;
const BUTTON_LABEL_MAX_LENGTH = 24;
const DESCRIPTION_MAX_LENGTH = 72;
const KEY_MAX_LENGTH = 80;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;
const TOKEN_PATTERN = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
const messageKeys = new Set<string>(CONVERSATION_MESSAGE_KEYS);
const labelKeys = new Set<string>(CONVERSATION_LABEL_KEYS);

type MutableResult = {
  errors: ConversationValidationIssue[];
  warnings: ConversationValidationIssue[];
  rejectedOverrides: string[];
  fallbackFields: string[];
};

function issue(
  result: MutableResult,
  severity: "error" | "warning",
  path: string,
  code: string,
  message: string,
): void {
  result[severity === "error" ? "errors" : "warnings"].push({ path, code, message, severity });
  if (severity === "error") {
    result.rejectedOverrides.push(path);
    result.fallbackFields.push(path);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function cleanText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean && Array.from(clean).length <= maximumLength && !CONTROL_CHARACTERS.test(clean)
    ? clean
    : undefined;
}

function cleanOptionalText(value: unknown, maximumLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return cleanText(value, maximumLength);
}

function cleanKey(value: unknown): string | undefined {
  const key = cleanText(value, KEY_MAX_LENGTH);
  return key && SAFE_KEY.test(key) ? key : undefined;
}

function tokenNames(template: string): string[] {
  return [...template.matchAll(TOKEN_PATTERN)].map((match) => match[1]).sort();
}

function sameTokens(candidate: string, fallback: string): boolean {
  return tokenNames(candidate).join("|") === tokenNames(fallback).join("|");
}

function normalizeMessages(value: unknown, path: string, result: MutableResult) {
  const source = record(value);
  if (!source) {
    if (value !== undefined) issue(result, "error", path, "INVALID_MESSAGES", "Messages must be an object.");
    return undefined;
  }
  const normalized: Partial<Record<ConversationMessageKey, string>> = {};
  for (const [rawKey, rawTemplate] of Object.entries(source)) {
    const fieldPath = `${path}.${rawKey}`;
    if (!messageKeys.has(rawKey)) {
      issue(result, "error", fieldPath, "UNKNOWN_MESSAGE_KEY", "The semantic message key is not registered.");
      continue;
    }
    const key = rawKey as ConversationMessageKey;
    const template = cleanText(rawTemplate, MESSAGE_MAX_LENGTH);
    if (!template) {
      issue(result, "error", fieldPath, "INVALID_MESSAGE_TEMPLATE", "The message template is empty, too long, or contains control characters.");
      continue;
    }
    const candidateTokens = tokenNames(template);
    const allowedTokens = tokenNames(AR_MA_MESSAGES[key]);
    const unknownTokens = candidateTokens.filter((token) => !allowedTokens.includes(token));
    if (unknownTokens.length) {
      issue(result, "error", fieldPath, "UNKNOWN_TEMPLATE_TOKEN", `Unknown template token: ${unknownTokens.join(", ")}.`);
      continue;
    }
    if (!sameTokens(template, AR_MA_MESSAGES[key])) {
      issue(result, "error", fieldPath, "MISSING_REQUIRED_TEMPLATE_TOKEN", "The template must preserve all required tokens for this message key.");
      continue;
    }
    normalized[key] = template;
  }
  return normalized;
}

function normalizeLabels(value: unknown, path: string, result: MutableResult) {
  const source = record(value);
  if (!source) {
    if (value !== undefined) issue(result, "error", path, "INVALID_LABELS", "Labels must be an object.");
    return undefined;
  }
  const normalized: Partial<Record<ConversationLabelKey, string>> = {};
  for (const [rawKey, rawTemplate] of Object.entries(source)) {
    const fieldPath = `${path}.${rawKey}`;
    if (!labelKeys.has(rawKey)) {
      issue(result, "error", fieldPath, "UNKNOWN_LABEL_KEY", "The visible label key is not registered.");
      continue;
    }
    const key = rawKey as ConversationLabelKey;
    const template = cleanText(rawTemplate, LABEL_MAX_LENGTH);
    if (!template || !sameTokens(template, AR_MA_LABELS[key])) {
      issue(result, "error", fieldPath, "INVALID_LABEL_TEMPLATE", "The label is invalid or does not preserve its required tokens.");
      continue;
    }
    normalized[key] = template;
  }
  return normalized;
}

function normalizeOutcome(
  raw: unknown,
  path: string,
  optionKeys: ReadonlySet<string>,
  textInputOptionKeys: ReadonlySet<string>,
  result: MutableResult,
): ConversationOutcomeReference | undefined {
  if (raw === undefined) return undefined;
  const source = record(raw);
  if (!source) {
    issue(result, "error", path, "INVALID_OUTCOME", "Outcome metadata must be an object.");
    return undefined;
  }
  const outcome: ConversationOutcomeReference = {
    ...(typeof source.responseMessageKey === "string" ? { responseMessageKey: source.responseMessageKey as ConversationMessageKey } : {}),
    ...(typeof source.nextPresentationKey === "string" ? { nextPresentationKey: source.nextPresentationKey as never } : {}),
    ...(typeof source.domainActionKey === "string" ? { domainActionKey: source.domainActionKey } : {}),
    ...(typeof source.requestConfiguredOptionKey === "string" ? { requestConfiguredOptionKey: source.requestConfiguredOptionKey } : {}),
    ...(typeof source.requestTextInputKey === "string" ? { requestTextInputKey: source.requestTextInputKey } : {}),
  };
  const problems = validateConversationOutcomeReference({ outcome, path, optionKeys, textInputOptionKeys });
  if (problems.length) {
    for (const problem of problems) issue(result, "error", problem.path, problem.code, problem.message);
    return undefined;
  }
  return outcome;
}

function normalizeValue(
  raw: unknown,
  path: string,
  optionKeys: ReadonlySet<string>,
  textInputOptionKeys: ReadonlySet<string>,
  labelMaximumLength: number,
  result: MutableResult,
): ConversationOptionValueConfig | undefined {
  const source = record(raw);
  if (!source) {
    issue(result, "error", path, "INVALID_OPTION_VALUE", "Option value must be an object.");
    return undefined;
  }
  const key = cleanKey(source.key);
  const canonicalValue = cleanText(source.canonicalValue, LABEL_MAX_LENGTH);
  const label = cleanText(source.label, labelMaximumLength);
  if (!key || !canonicalValue || !label) {
    issue(result, "error", path, "INVALID_OPTION_VALUE", "Option values require a safe key, canonical value, and visible label.");
    return undefined;
  }
  const description = cleanOptionalText(source.description, DESCRIPTION_MAX_LENGTH);
  if (description === undefined && source.description !== undefined) {
    issue(result, "error", `${path}.description`, "INVALID_DESCRIPTION", "The row description is too long or unsafe.");
  }
  const outcome = normalizeOutcome(source.outcome, `${path}.outcome`, optionKeys, textInputOptionKeys, result);
  return {
    key,
    canonicalValue,
    label,
    ...(description ? { description } : {}),
    enabled: source.enabled !== false,
    available: source.available !== false,
    order: Number.isInteger(source.order) ? Number(source.order) : 0,
    ...(outcome ? { outcome } : {}),
  };
}

function optionKeysFrom(rawOptions: unknown): { optionKeys: Set<string>; textInputOptionKeys: Set<string> } {
  const optionKeys = new Set<string>();
  const textInputOptionKeys = new Set<string>();
  if (!Array.isArray(rawOptions)) return { optionKeys, textInputOptionKeys };
  for (const raw of rawOptions) {
    const source = record(raw);
    const key = cleanKey(source?.key);
    if (!key) continue;
    optionKeys.add(key);
    if (source?.inputType === "text") textInputOptionKeys.add(key);
  }
  return { optionKeys, textInputOptionKeys };
}

function normalizeOptions(value: unknown, path: string, result: MutableResult): readonly ConversationOptionConfig[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issue(result, "error", path, "INVALID_OPTIONS", "Options must be an array.");
    return undefined;
  }
  const { optionKeys, textInputOptionKeys } = optionKeysFrom(value);
  const seenOptions = new Set<string>();
  const normalized: ConversationOptionConfig[] = [];
  value.forEach((raw, index) => {
    const optionPath = `${path}.${index}`;
    const source = record(raw);
    const key = cleanKey(source?.key);
    const label = cleanText(source?.label, LABEL_MAX_LENGTH);
    const requirement = source?.requirement;
    const inputType = source?.inputType;
    const promptMessageKey = source?.promptMessageKey;
    if (!source || !key || !label || !["required", "optional", "disabled"].includes(String(requirement)) || !["buttons", "list", "text", "auto"].includes(String(inputType)) || !messageKeys.has(String(promptMessageKey))) {
      issue(result, "error", optionPath, "INVALID_OPTION", "Option definition is missing a safe key, label, requirement, input type, or registered prompt key.");
      return;
    }
    if (seenOptions.has(key)) {
      issue(result, "error", `${optionPath}.key`, "DUPLICATE_OPTION_KEY", "Option keys must be unique.");
      return;
    }
    seenOptions.add(key);
    const rawValues = Array.isArray(source.values) ? source.values : [];
    const seenValues = new Set<string>();
    const values: ConversationOptionValueConfig[] = [];
    rawValues.forEach((rawValue, valueIndex) => {
      const valuePath = `${optionPath}.values.${valueIndex}`;
      const candidate = normalizeValue(
        rawValue,
        valuePath,
        optionKeys,
        textInputOptionKeys,
        inputType === "buttons" ? BUTTON_LABEL_MAX_LENGTH : 48,
        result,
      );
      if (!candidate) return;
      if (seenValues.has(candidate.key)) {
        issue(result, "error", `${valuePath}.key`, "DUPLICATE_OPTION_VALUE_KEY", "Value keys must be unique inside an option.");
        return;
      }
      seenValues.add(candidate.key);
      values.push(candidate);
    });
    if (inputType !== "text" && source.enabled !== false && requirement !== "disabled" && !values.length) {
      issue(result, "warning", `${optionPath}.values`, "OPTION_HAS_NO_VALUES", "An enabled selectable option has no valid values and will use safe text fallback.");
    }
    const presentationSource = record(source.presentation);
    const buttonLabel = cleanOptionalText(presentationSource?.buttonLabel, BUTTON_LABEL_MAX_LENGTH);
    const title = cleanOptionalText(presentationSource?.title, LABEL_MAX_LENGTH);
    const sectionTitle = cleanOptionalText(presentationSource?.sectionTitle, LABEL_MAX_LENGTH);
    const fallbackText = cleanOptionalText(presentationSource?.fallbackText, MESSAGE_MAX_LENGTH);
    const currentValueMarker = cleanOptionalText(presentationSource?.currentValueMarker, LABEL_MAX_LENGTH);
    const outcome = normalizeOutcome(source.outcome, `${optionPath}.outcome`, optionKeys, textInputOptionKeys, result);
    normalized.push({
      key,
      label,
      enabled: source.enabled !== false,
      requirement: requirement as ConversationOptionConfig["requirement"],
      order: Number.isInteger(source.order) ? Number(source.order) : index,
      inputType: inputType as ConversationOptionConfig["inputType"],
      promptMessageKey: promptMessageKey as ConversationMessageKey,
      values: values.sort((left, right) => left.order - right.order),
      ...(presentationSource ? { presentation: {
        ...(title ? { title } : {}),
        ...(sectionTitle ? { sectionTitle } : {}),
        ...(buttonLabel ? { buttonLabel } : {}),
        ...(fallbackText ? { fallbackText } : {}),
        ...(currentValueMarker ? { currentValueMarker } : {}),
      } } : {}),
      ...(outcome ? { outcome } : {}),
    });
  });
  return normalized.sort((left, right) => left.order - right.order);
}

function normalizeRow(
  raw: unknown,
  path: string,
  optionKeys: ReadonlySet<string>,
  textInputOptionKeys: ReadonlySet<string>,
  result: MutableResult,
): ConversationListRowConfig | undefined {
  const source = record(raw);
  const key = cleanKey(source?.key);
  const label = cleanText(source?.label, LABEL_MAX_LENGTH);
  if (!source || !key || !label) {
    issue(result, "error", path, "INVALID_LIST_ROW", "List rows require a safe stable key and visible label.");
    return undefined;
  }
  const description = cleanOptionalText(source.description, DESCRIPTION_MAX_LENGTH);
  const outcome = normalizeOutcome(source.outcome, `${path}.outcome`, optionKeys, textInputOptionKeys, result);
  return {
    key,
    label,
    ...(description ? { description } : {}),
    enabled: source.enabled !== false,
    available: source.available !== false,
    order: Number.isInteger(source.order) ? Number(source.order) : 0,
    ...(outcome ? { outcome } : {}),
  };
}

function normalizeLists(
  value: unknown,
  path: string,
  optionKeys: ReadonlySet<string>,
  textInputOptionKeys: ReadonlySet<string>,
  result: MutableResult,
): readonly ConversationListConfig[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issue(result, "error", path, "INVALID_LISTS", "Lists must be an array.");
    return undefined;
  }
  const normalized: ConversationListConfig[] = [];
  const seenLists = new Set<string>();
  value.forEach((raw, index) => {
    const listPath = `${path}.${index}`;
    const source = record(raw);
    const key = cleanKey(source?.key);
    const openingButtonLabel = cleanText(source?.openingButtonLabel, BUTTON_LABEL_MAX_LENGTH);
    if (!source || !key || !openingButtonLabel || !messageKeys.has(String(source.bodyMessageKey))) {
      issue(result, "error", listPath, "INVALID_LIST", "List requires a safe key, registered body message key, and valid opening button label.");
      return;
    }
    if (seenLists.has(key)) {
      issue(result, "error", `${listPath}.key`, "DUPLICATE_LIST_KEY", "List keys must be unique.");
      return;
    }
    seenLists.add(key);
    const sections: ConversationListSectionConfig[] = [];
    const seenSections = new Set<string>();
    (Array.isArray(source.sections) ? source.sections : []).forEach((rawSection, sectionIndex) => {
      const sectionPath = `${listPath}.sections.${sectionIndex}`;
      const sectionSource = record(rawSection);
      const sectionKey = cleanKey(sectionSource?.key);
      if (!sectionSource || !sectionKey || seenSections.has(sectionKey)) {
        issue(result, "error", sectionPath, "INVALID_LIST_SECTION", "List sections require unique stable keys.");
        return;
      }
      seenSections.add(sectionKey);
      const rows = (Array.isArray(sectionSource.rows) ? sectionSource.rows : [])
        .map((row, rowIndex) => normalizeRow(row, `${sectionPath}.rows.${rowIndex}`, optionKeys, textInputOptionKeys, result))
        .filter((row): row is ConversationListRowConfig => Boolean(row));
      sections.push({
        key: sectionKey,
        ...(cleanText(sectionSource.title, LABEL_MAX_LENGTH) ? { title: cleanText(sectionSource.title, LABEL_MAX_LENGTH) } : {}),
        enabled: sectionSource.enabled !== false,
        order: Number.isInteger(sectionSource.order) ? Number(sectionSource.order) : sectionIndex,
        rows: rows.sort((left, right) => left.order - right.order),
      });
    });
    const outcome = normalizeOutcome(source.outcome, `${listPath}.outcome`, optionKeys, textInputOptionKeys, result);
    normalized.push({
      key,
      enabled: source.enabled !== false,
      bodyMessageKey: source.bodyMessageKey as ConversationMessageKey,
      openingButtonLabel,
      ...(cleanText(source.title, LABEL_MAX_LENGTH) ? { title: cleanText(source.title, LABEL_MAX_LENGTH) } : {}),
      ...(cleanText(source.fallbackText, MESSAGE_MAX_LENGTH) ? { fallbackText: cleanText(source.fallbackText, MESSAGE_MAX_LENGTH) } : {}),
      sections: sections.sort((left, right) => left.order - right.order),
      ...(outcome ? { outcome } : {}),
    });
  });
  const links = new Map(
    normalized
      .filter((list) => list.outcome?.nextPresentationKey)
      .map((list) => [list.key, list.outcome!.nextPresentationKey!] as const),
  );
  for (const start of links.keys()) {
    const visited = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor && links.has(cursor)) {
      if (visited.has(cursor)) {
        issue(result, "error", `${path}.${start}.outcome.nextPresentationKey`, "CIRCULAR_PRESENTATION_CHAIN", "Circular next-presentation chains are not allowed.");
        const target = normalized.find((list) => list.key === start);
        if (target) {
          const index = normalized.indexOf(target);
          normalized[index] = { ...target, outcome: undefined };
        }
        break;
      }
      visited.add(cursor);
      cursor = links.get(cursor);
    }
  }
  return normalized;
}

export class ConversationConfigValidator {
  validate(raw: unknown, path = "config"): ConversationConfigValidationResult {
    const result: MutableResult = { errors: [], warnings: [], rejectedOverrides: [], fallbackFields: [] };
    const source = record(raw);
    if (!source) {
      issue(result, "error", path, "INVALID_CONFIGURATION", "Conversation configuration must be an object.");
      return { valid: false, ...result };
    }
    if (source.schemaVersion !== CONVERSATION_CONFIG_SCHEMA_VERSION) {
      issue(result, "error", `${path}.schemaVersion`, "UNSUPPORTED_SCHEMA_VERSION", `Only schema version ${CONVERSATION_CONFIG_SCHEMA_VERSION} is supported.`);
      return { valid: false, ...result };
    }
    if (source.locale !== undefined && source.locale !== "ar-MA") {
      issue(result, "error", `${path}.locale`, "UNSUPPORTED_LOCALE", "Only ar-MA is currently supported.");
    }
    const messages = normalizeMessages(source.messages, `${path}.messages`, result);
    const labels = normalizeLabels(source.labels, `${path}.labels`, result);
    const wordingSource = record(source.productWording);
    const productWording = wordingSource
      ? Object.fromEntries(["fullName", "conversationalName", "singularName", "pluralName"]
          .map((key) => [key, cleanText(wordingSource[key], LABEL_MAX_LENGTH)] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[1])))
      : undefined;
    const optionReferences = optionKeysFrom(source.options);
    const options = normalizeOptions(source.options, `${path}.options`, result);
    const lists = normalizeLists(
      source.lists,
      `${path}.lists`,
      optionReferences.optionKeys,
      optionReferences.textInputOptionKeys,
      result,
    );
    const normalizedConfig: ConversationConfigurationOverride = {
      schemaVersion: CONVERSATION_CONFIG_SCHEMA_VERSION,
      ...(source.locale === "ar-MA" ? { locale: "ar-MA" } : {}),
      ...(messages ? { messages } : {}),
      ...(labels ? { labels } : {}),
      ...(productWording && Object.keys(productWording).length ? { productWording } : {}),
      ...(options ? { options } : {}),
      ...(lists ? { lists } : {}),
    };
    return {
      valid: result.errors.length === 0,
      ...result,
      normalizedConfig,
    };
  }
}

export const conversationConfigValidator = new ConversationConfigValidator();

export function getConversationTemplateTokenContract(): Readonly<Record<ConversationMessageKey, readonly string[]>> {
  return Object.fromEntries(
    CONVERSATION_MESSAGE_KEYS.map((key) => [key, tokenNames(AR_MA_MESSAGES[key])]),
  ) as unknown as Readonly<Record<ConversationMessageKey, readonly string[]>>;
}
