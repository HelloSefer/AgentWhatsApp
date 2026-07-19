import type { AgentReplyUiHint } from "../../reply/reply-renderer.types";
import type {
  DeliveryConfirmationPresentation,
  DeliveryRequirement,
  FinalOrderReview,
} from "./delivery-confirmation.types";

const MAX_BUTTON_OPTIONS = 3;
const MAX_ACTION_ID_LENGTH = 200;
const MAX_ACTION_SEGMENT_LENGTH = 80;
const UNSAFE_ACTION_SEGMENT = /[:%\s\u0000-\u001F\u007F-\u009F]/u;

function isSafeActionSegment(value: string): boolean {
  return (
    Boolean(value) &&
    Array.from(value).length <= MAX_ACTION_SEGMENT_LENGTH &&
    !UNSAFE_ACTION_SEGMENT.test(value)
  );
}

function cloneUiHints(uiHints: AgentReplyUiHint): AgentReplyUiHint {
  return {
    ...uiHints,
    options: uiHints.options?.map((option) => ({ ...option })),
  };
}

function result(input: DeliveryConfirmationPresentation): DeliveryConfirmationPresentation {
  return {
    ...input,
    ...(input.field ? { field: { ...input.field } } : {}),
    ...(input.uiHints ? { uiHints: cloneUiHints(input.uiHints) } : {}),
  };
}

export function buildDeliveryFieldSelectActionId(fieldKey: string): string | undefined {
  const value = fieldKey.trim();
  const id = `order_checkout_field:select:${value}`;
  return isSafeActionSegment(value) && Array.from(id).length <= MAX_ACTION_ID_LENGTH
    ? id
    : undefined;
}

export function buildDeliveryFieldValueActionId(
  fieldKey: string,
  canonicalValue: string,
): string | undefined {
  const field = fieldKey.trim();
  const value = canonicalValue.trim();
  const id = `order_checkout_field:value:${field}:${value}`;
  return (
    isSafeActionSegment(field) &&
    isSafeActionSegment(value) &&
    Array.from(id).length <= MAX_ACTION_ID_LENGTH
  )
    ? id
    : undefined;
}

function fieldPrompt(field: DeliveryRequirement): string {
  return field.prompt || `عافاك دخل ${field.label}`;
}

/** Platform-neutral prompts only. Sending is outside the preview boundary. */
export function buildDeliveryFieldPresentation(
  field: DeliveryRequirement,
): DeliveryConfirmationPresentation {
  const options = field.options || [];
  const mapped = options.map((canonicalValue) => ({
    canonicalValue,
    id: buildDeliveryFieldValueActionId(field.key, canonicalValue),
  }));
  const canUseOptions = mapped.length === options.length && mapped.every((option) => option.id);

  if (canUseOptions && options.length > 0) {
    const uiHints: AgentReplyUiHint = {
      kind: options.length <= MAX_BUTTON_OPTIONS ? "buttons" : "list",
      purpose: "delivery_confirmation",
      title: field.label,
      body: fieldPrompt(field),
      options: mapped.map((option) => ({
        id: option.id!,
        label: option.canonicalValue,
        value: option.canonicalValue,
      })),
      previewOnly: true,
    };
    return result({
      kind: "FIELD_OPTIONS",
      promptKey: "COLLECT_ORDER_FIELD",
      text: fieldPrompt(field),
      field: { key: field.key, label: field.label },
      uiHints,
    });
  }

  return result({
    kind: "COLLECT_FIELD",
    promptKey: "COLLECT_ORDER_FIELD",
    text: fieldPrompt(field),
    field: { key: field.key, label: field.label },
  });
}

export function buildFinalOrderReviewPresentation(
  review: FinalOrderReview,
): DeliveryConfirmationPresentation {
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "delivery_confirmation",
    body: `راجع الطلب ديالك: ${review.completedUnits} قطعة`,
    options: [
      { id: "order_checkout:confirm", label: "أكد الطلب" },
      { id: "order_checkout:edit_delivery", label: "بدل معلومات التوصيل" },
      { id: "order_checkout:back_to_cart", label: "رجع للسلة" },
    ],
    previewOnly: true,
  };
  return result({
    kind: "FINAL_ORDER_REVIEW",
    promptKey: "FINAL_ORDER_REVIEW",
    text: "راجع معلومات الطلب ومن بعد أكد الطلب",
    uiHints,
  });
}

export function buildDeliveryFieldSelectorPresentation(
  requirements: readonly DeliveryRequirement[],
): DeliveryConfirmationPresentation {
  const options = requirements
    .map((field) => ({ field, id: buildDeliveryFieldSelectActionId(field.key) }))
    .filter((entry): entry is { field: DeliveryRequirement; id: string } => Boolean(entry.id));
  const uiHints: AgentReplyUiHint | undefined = options.length === requirements.length
    ? {
        kind: options.length <= MAX_BUTTON_OPTIONS ? "buttons" : "list",
        purpose: "delivery_confirmation",
        title: "معلومات التوصيل",
        body: "اختار المعلومة اللي بغيتي تبدل",
        options: options.map(({ field, id }) => ({ id, label: field.label, value: field.key })),
        previewOnly: true,
      }
    : undefined;
  return result({
    kind: "EDIT_FIELD_SELECTOR",
    promptKey: "EDIT_ORDER_FIELD",
    text: "اختار المعلومة اللي بغيتي تبدل",
    ...(uiHints ? { uiHints } : {}),
  });
}

export function buildCommercialResolutionPresentation(): DeliveryConfirmationPresentation {
  return result({
    kind: "BLOCKED",
    promptKey: "RESOLVE_COMMERCIAL_STATE",
    text: "العرض المختار ما بقاش مناسب للسلة. رجع للسلة باش تحل هاد المشكل.",
  });
}

export function buildBlockedDeliveryPresentation(): DeliveryConfirmationPresentation {
  return result({ kind: "BLOCKED", promptKey: "BLOCKED" });
}
