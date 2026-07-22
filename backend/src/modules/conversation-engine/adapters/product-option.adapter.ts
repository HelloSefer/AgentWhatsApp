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
    values: (field.options || []).map((canonicalValue, order) => ({
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
    promptKey: field.key === "size" ? "order.first_size_prompt" : "order.first_option_prompt",
    ...(field.key === "size" ? { listButtonLabel: orderLabel("order.size_list_button") } : {}),
    actionNamespace: "cart_item_option",
  };
}
