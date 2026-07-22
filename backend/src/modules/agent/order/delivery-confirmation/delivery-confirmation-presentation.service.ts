import type { AgentReplyUiHint } from "../../reply/reply-renderer.types";
import type { ProductContext } from "../../config/product-context.types";
import type {
  DeliveryConfirmationPresentation,
  DeliveryRequirement,
  FinalOrderReview,
} from "./delivery-confirmation.types";
import { renderFinalOrderReview } from "./final-order-review-renderer.service";
import {
  deliveryLabel,
  deliveryMessage,
} from "../../../conversation-engine/adapters/delivery-conversation.adapter";

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
  return field.prompt || deliveryMessage("delivery.field_prompt", { fieldLabel: field.label });
}

export function buildGroupedDeliveryFieldPresentation(
  fields: readonly DeliveryRequirement[],
): DeliveryConfirmationPresentation {
  const labels = fields.map((field) => field.label).filter(Boolean);
  const isStandardIdentityGroup = fields.length === 3 && ["fullName", "phone", "city"].every(
    (key) => fields.some((field) => field.key === key),
  );
  return result({
    kind: "COLLECT_FIELD",
    promptKey: "COLLECT_ORDER_FIELD",
    text: isStandardIdentityGroup
      ? deliveryMessage("delivery.grouped_request")
      : deliveryMessage("delivery.grouped_custom_request", {
          fieldLines: labels
            .map((label) => deliveryMessage("delivery.field_bullet", { fieldLabel: label }))
            .join("\n"),
        }),
    field: { key: fields.map((field) => field.key).join(","), label: labels.join("، ") },
  });
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
  productContext?: Pick<ProductContext, "conversationalName" | "pluralName">,
): DeliveryConfirmationPresentation {
  const rendered = renderFinalOrderReview(review, productContext);
  const uiHints: AgentReplyUiHint = {
    kind: "buttons",
    purpose: "delivery_confirmation",
    body: rendered.confirmationText,
    options: [
      { id: "order_checkout:confirm", label: deliveryLabel("checkout.confirm") },
      { id: "order_checkout:back_to_cart", label: deliveryLabel("checkout.edit_order") },
      { id: "order_checkout:edit_delivery", label: deliveryLabel("checkout.edit_delivery") },
    ],
    previewOnly: true,
  };
  return result({
    kind: "FINAL_ORDER_REVIEW",
    promptKey: "FINAL_ORDER_REVIEW",
    text: rendered.text,
    uiHints,
    orderConfirmationPresentation: rendered.presentation,
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
        title: deliveryLabel("delivery.title"),
        body: deliveryMessage("delivery.edit_selector"),
        options: options.map(({ field, id }) => ({ id, label: field.label, value: field.key })),
        previewOnly: true,
      }
    : undefined;
  return result({
    kind: "EDIT_FIELD_SELECTOR",
    promptKey: "EDIT_ORDER_FIELD",
    text: deliveryMessage("delivery.edit_selector"),
    ...(uiHints ? { uiHints } : {}),
  });
}

export function buildCommercialResolutionPresentation(): DeliveryConfirmationPresentation {
  return result({
    kind: "BLOCKED",
    promptKey: "RESOLVE_COMMERCIAL_STATE",
    text: deliveryMessage("delivery.commercial_resolution"),
  });
}

export function buildBlockedDeliveryPresentation(): DeliveryConfirmationPresentation {
  return result({ kind: "BLOCKED", promptKey: "BLOCKED" });
}
