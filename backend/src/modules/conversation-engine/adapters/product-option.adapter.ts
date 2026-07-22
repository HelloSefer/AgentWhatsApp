import type { RequiredOrderField } from "../../agent/config/required-fields.types";
import type { ConversationProductOption } from "../contracts/product-conversation.types";
import { orderLabel } from "./order-conversation.adapter";

export function toConversationProductOption(field: RequiredOrderField): ConversationProductOption {
  const requirement = field.enabled
    ? (field.requirement || (field.required ? "REQUIRED" : "OPTIONAL")) === "REQUIRED"
      ? "required"
      : "optional"
    : "disabled";
  return {
    key: field.key,
    label: field.label || field.key,
    inputType: field.display || (field.options?.length ? "auto" : "text"),
    requirement,
    enabled: field.enabled,
    order: field.askOrder,
    values: field.valueConfigurations?.length
      ? field.valueConfigurations.map((value) => ({
          key: value.key,
          canonicalValue: value.canonicalValue,
          displayLabel: value.label,
          ...(value.description ? { description: value.description } : {}),
          enabled: value.enabled,
          order: value.order,
          available: value.available,
        }))
      : (field.options || []).map((canonicalValue, order) => ({
          key: canonicalValue,
          canonicalValue,
          displayLabel: canonicalValue,
          enabled: true,
          order,
          available: true,
        })),
    ...(field.minValue !== undefined || field.maxValue !== undefined
      ? { validation: { minValue: field.minValue, maxValue: field.maxValue } }
      : {}),
    selectionMode: "single",
    promptKey: (field.promptMessageKey as ConversationProductOption["promptKey"] | undefined)
      || (field.key === "size" ? "order.first_size_prompt" : "order.first_option_prompt"),
    ...(field.presentation?.buttonLabel
      ? { listButtonLabel: field.presentation.buttonLabel }
      : field.key === "size"
        ? { listButtonLabel: orderLabel("order.size_list_button") }
        : {}),
    ...(field.presentation?.title ? { listTitle: field.presentation.title } : {}),
    ...(field.presentation?.sectionTitle ? { sectionTitle: field.presentation.sectionTitle } : {}),
    ...(field.presentation?.fallbackText ? { fallbackText: field.presentation.fallbackText } : {}),
    ...(field.presentation?.currentValueMarker ? { currentValueMarker: field.presentation.currentValueMarker } : {}),
    actionNamespace: "cart_item_option",
  };
}
