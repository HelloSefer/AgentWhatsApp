import type { RequiredOrderField } from "../../../config/required-fields.types";
import type { AgentReplyUiHint } from "../../../reply/reply-renderer.types";
import type { ItemCollectionProgress } from "../item-collection.types";
import type {
  ItemCollectionOptionActionId,
  ItemCollectionPresentationField,
  ItemCollectionPresentationInput,
  ItemCollectionPresentationResult,
} from "./item-collection-presentation.types";
import {
  orderLabel,
  orderMessage,
} from "../../../../conversation-engine/adapters/order-conversation.adapter";
import { toConversationProductOption } from "../../../../conversation-engine/adapters/product-option.adapter";

const MAX_BUTTON_OPTIONS = 3;
const MAX_ACTION_ID_LENGTH = 200;
const MAX_ACTION_SEGMENT_LENGTH = 80;
const MAX_BUTTON_LABEL_LENGTH = 24;
const MAX_LIST_LABEL_LENGTH = 48;
const UNSAFE_ACTION_SEGMENT = /[:\s\u0000-\u001F\u007F-\u009F]/u;

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F\u007F-\u009F]/gu, "").replace(/\s+/gu, " ").trim()
    : "";
}

/** Code-point truncation keeps Unicode labels valid and presentation-only. */
export function truncateItemCollectionPresentationText(value: string, maximumLength: number): string {
  const characters = Array.from(cleanText(value));
  if (characters.length <= maximumLength) return characters.join("");
  if (maximumLength <= 1) return characters.slice(0, Math.max(0, maximumLength)).join("");
  return `${characters.slice(0, maximumLength - 1).join("").trimEnd()}…`;
}

function cloneProgress(progress: ItemCollectionProgress): ItemCollectionProgress {
  return { ...progress };
}

function cloneUiHints(uiHints: AgentReplyUiHint): AgentReplyUiHint {
  return {
    ...uiHints,
    options: uiHints.options?.map((option) => ({ ...option })),
  };
}

function fieldMetadata(field: RequiredOrderField): ItemCollectionPresentationField {
  return {
    key: field.key,
    ...(field.label ? { label: field.label } : {}),
    ...(field.semanticType ? { semanticType: field.semanticType } : {}),
  };
}

function findField(fields: RequiredOrderField[], key: string): RequiredOrderField | undefined {
  const normalized = key.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
  return fields.find(
    (field) => field.key.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "") === normalized,
  );
}

function isSafeActionSegment(value: string): boolean {
  return (
    Boolean(value) &&
    Array.from(value).length <= MAX_ACTION_SEGMENT_LENGTH &&
    !UNSAFE_ACTION_SEGMENT.test(value)
  );
}

/** Builds an ID from canonical configuration only. Display labels never affect it. */
export function buildItemCollectionOptionActionId(
  fieldKey: string,
  canonicalValue: string,
): ItemCollectionOptionActionId | undefined {
  const field = fieldKey.trim();
  const value = canonicalValue.trim();
  const id = `cart_item_option:${field}:${value}`;
  return isSafeActionSegment(field) && isSafeActionSegment(value) && Array.from(id).length <= MAX_ACTION_ID_LENGTH
    ? (id as ItemCollectionOptionActionId)
    : undefined;
}

/** Reuses the canonical item-option action IDs before the first planned item exists. */
export function buildOrderEntryOptionPresentation(
  field: RequiredOrderField,
): { text: string; uiHints?: AgentReplyUiHint } {
  const option = toConversationProductOption(field);
  const isSize = option.key === "size";
  const text = isSize
    ? orderMessage("order.first_size_prompt")
    : orderMessage("order.first_option_prompt", { optionLabel: option.label });
  const options = option.values
    .filter((value) => value.enabled && value.available !== false)
    .sort((left, right) => left.order - right.order);

  if (!options.length) {
    return { text };
  }

  const usesButtons = options.length <= MAX_BUTTON_OPTIONS;
  const mappedOptions: NonNullable<AgentReplyUiHint["options"]> = [];
  for (const value of options) {
    const id = buildItemCollectionOptionActionId(field.key, value.key);
    if (!id) return { text };
    mappedOptions.push({
      id,
      label: truncateItemCollectionPresentationText(
        value.displayLabel,
        usesButtons ? MAX_BUTTON_LABEL_LENGTH : MAX_LIST_LABEL_LENGTH,
      ),
      value: value.description || value.canonicalValue,
    });
  }

  return {
    text,
    uiHints: {
      kind: usesButtons ? "buttons" : "list",
      purpose: "field_options",
      ...(usesButtons ? {} : { title: option.listTitle || field.label || field.key }),
      ...(!usesButtons && option.listButtonLabel ? { buttonText: option.listButtonLabel } : {}),
      body: text,
      options: mappedOptions,
      previewOnly: true,
    },
  };
}

function displayLabel(input: {
  canonicalValue: string;
  labels?: Readonly<Record<string, string>>;
  maximumLength: number;
}): string {
  const configured = cleanText(input.labels?.[input.canonicalValue]);
  return truncateItemCollectionPresentationText(
    configured || input.canonicalValue,
    input.maximumLength,
  );
}

function result(input: {
  success: boolean;
  kind: ItemCollectionPresentationResult["kind"];
  promptKey: ItemCollectionPresentationResult["promptKey"];
  progress: ItemCollectionProgress;
  text?: string;
  field?: ItemCollectionPresentationField;
  uiHints?: AgentReplyUiHint;
  itemNumber?: number;
  failureCode?: ItemCollectionPresentationResult["failureCode"];
  warnings?: string[];
}): ItemCollectionPresentationResult {
  return {
    success: input.success,
    kind: input.kind,
    promptKey: input.promptKey,
    progress: cloneProgress(input.progress),
    ...(input.text ? { text: input.text } : {}),
    ...(input.field ? { field: { ...input.field } } : {}),
    ...(input.uiHints ? { uiHints: cloneUiHints(input.uiHints) } : {}),
    ...(input.itemNumber ? { itemNumber: input.itemNumber } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    warnings: [...(input.warnings || [])],
  };
}

function currentItemNumber(progress: ItemCollectionProgress): number | undefined {
  return progress.currentItemNumber || (progress.remainingUnits > 0 ? progress.completedUnits + 1 : undefined);
}

/**
 * Converts a trusted D2A state into platform-neutral metadata only. It never
 * executes item actions, mutates cart data, or builds a transport payload.
 */
export function buildItemCollectionPresentation(
  input: ItemCollectionPresentationInput,
): ItemCollectionPresentationResult {
  const { progression } = input;
  const progress = progression.progress;

  if (progression.step === "BLOCKED") {
    return result({
      success: false,
      kind: "BLOCKED",
      promptKey: "BLOCKED",
      progress,
      failureCode: progression.failureCode,
      warnings: progression.warnings,
    });
  }

  if (progression.step === "START_COLLECTION" || progression.step === "START_CURRENT_ITEM") {
    return result({
      success: progression.success,
      kind: "START_COLLECTION",
      promptKey: "START_COLLECTION",
      text: orderMessage("order.next_item_start"),
      progress,
      itemNumber: currentItemNumber(progress),
      warnings: progression.warnings,
    });
  }

  if (progression.step === "COLLECT_OPTION") {
    const fieldKey = progression.field?.key;
    const field = fieldKey ? findField(input.requiredFields, fieldKey) : undefined;
    if (!field) {
      return result({
        success: false,
        kind: "BLOCKED",
        promptKey: "BLOCKED",
        progress,
        failureCode: "FIELD_NOT_CONFIGURED",
        warnings: progression.warnings,
      });
    }

    const metadata = fieldMetadata(field);
    const itemNumber = currentItemNumber(progress);
    if (!field.options?.length) {
      return result({
        success: progression.success,
        kind: "OPTION_TEXT_INPUT",
        promptKey: "ENTER_ITEM_OPTION",
        text: orderMessage("order.option_text_prompt", { optionLabel: field.label || field.key }),
        field: metadata,
        progress,
        itemNumber,
        failureCode: progression.failureCode,
        warnings: progression.warnings,
      });
    }

    const seenActionIds = new Set<string>();
    const configuredOption = toConversationProductOption(field);
    const configuredValues = configuredOption.values
      .filter((value) => value.enabled && value.available !== false)
      .sort((left, right) => left.order - right.order);
    const optionCount = configuredValues.length;
    const usesButtons = optionCount <= MAX_BUTTON_OPTIONS;
    const options: NonNullable<AgentReplyUiHint["options"]> = [];
    for (const value of configuredValues) {
      const actionId = buildItemCollectionOptionActionId(field.key, value.key);
      if (!actionId) {
        return result({
          success: false,
          kind: "BLOCKED",
          promptKey: "BLOCKED",
          progress,
          failureCode: "UNSAFE_ACTION_ID",
          warnings: progression.warnings,
        });
      }
      if (seenActionIds.has(actionId)) {
        return result({
          success: false,
          kind: "BLOCKED",
          promptKey: "BLOCKED",
          progress,
          failureCode: "DUPLICATE_ACTION_ID",
          warnings: progression.warnings,
        });
      }
      seenActionIds.add(actionId);
      options.push({
        id: actionId,
        label: truncateItemCollectionPresentationText(
          cleanText(input.optionDisplayLabels?.[value.canonicalValue]) || value.displayLabel,
          usesButtons ? MAX_BUTTON_LABEL_LENGTH : MAX_LIST_LABEL_LENGTH,
        ),
        value: value.description || value.canonicalValue,
      });
    }

    const text = orderMessage("order.item_option_prompt", { optionLabel: field.label || field.key });
    const uiHints: AgentReplyUiHint = {
      kind: usesButtons ? "buttons" : "list",
      purpose: "field_options",
      ...(usesButtons ? {} : { title: truncateItemCollectionPresentationText(configuredOption.listTitle || field.label || field.key, MAX_LIST_LABEL_LENGTH) }),
      ...(!usesButtons && configuredOption.listButtonLabel ? { buttonText: configuredOption.listButtonLabel } : {}),
      body: text,
      options,
      previewOnly: true,
    };
    return result({
      success: progression.success,
      kind: usesButtons ? "OPTION_BUTTONS" : "OPTION_LIST",
      promptKey: "SELECT_ITEM_OPTION",
      text,
      field: metadata,
      uiHints,
      progress,
      itemNumber,
      failureCode: progression.failureCode,
      warnings: progression.warnings,
    });
  }

  if (progression.step === "COLLECT_QUANTITY") {
    return result({
      success: progression.success,
      kind: "QUANTITY_INPUT",
      promptKey: "SELECT_ITEM_QUANTITY",
      text: orderMessage("order.item_quantity_prompt"),
      progress,
      itemNumber: currentItemNumber(progress),
      failureCode: progression.failureCode,
      warnings: progression.warnings,
    });
  }

  if (progression.step === "READY_TO_FINALIZE") {
    return result({
      success: progression.success,
      kind: "READY_TO_FINALIZE",
      promptKey: "CURRENT_ITEM_READY",
      text: orderMessage("order.item_ready"),
      progress,
      itemNumber: currentItemNumber(progress),
      warnings: progression.warnings,
    });
  }

  if (progression.step === "START_NEXT_ITEM") {
    return result({
      success: progression.success,
      kind: "START_NEXT_ITEM",
      promptKey: "START_NEXT_ITEM",
      text: orderMessage("order.next_item_start"),
      progress,
      itemNumber: progress.completedUnits + 1,
      warnings: progression.warnings,
    });
  }

  return result({
    success: progression.success,
    kind: "CART_REVIEW_READY",
    promptKey: "CART_REVIEW_READY",
    text: orderMessage("order.ready_for_review"),
    progress,
    warnings: progression.warnings,
  });
}
