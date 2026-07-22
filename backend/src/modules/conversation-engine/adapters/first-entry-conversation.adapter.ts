import type { FirstEntryCtaMode, GreetingStyle } from "../../agent/config/seller-config.types";
import { renderConversationLabel, renderConversationMessage } from "../rendering/conversation-renderer.service";

export function firstEntryLabel(
  key: "first_entry.order_now" | "first_entry.more_info" | "first_entry.choice_title" | "first_entry.payment_cod",
): string {
  return renderConversationLabel(key);
}

export function firstEntryCommercialIntro(): string {
  return renderConversationMessage("first_entry.commercial_intro");
}

export function firstEntryProductLine(input: {
  productFullName?: string;
  price?: string;
}): string | undefined {
  if (input.productFullName && input.price) {
    return renderConversationMessage("first_entry.product_with_price", {
      productFullName: input.productFullName,
      price: input.price,
    });
  }
  if (input.productFullName) {
    return renderConversationMessage("first_entry.product_only", {
      productFullName: input.productFullName,
    });
  }
  if (input.price) {
    return renderConversationMessage("first_entry.price_only", { price: input.price });
  }
  return undefined;
}

export function firstEntryDeliveryLine(input:
  | { kind: "all_free" }
  | { kind: "all_paid"; deliveryAmount: number; currency: string }
  | { kind: "all_unspecified" }
  | { kind: "selected_cities"; cities: string }
  | { kind: "excluded_cities"; cities: string }
  | { kind: "by_city" }
  | { kind: "unavailable" }
): string {
  if (input.kind === "all_free") return renderConversationMessage("first_entry.delivery_all_free");
  if (input.kind === "all_paid") {
    return renderConversationMessage("first_entry.delivery_all_paid", {
      deliveryAmount: input.deliveryAmount,
      currency: input.currency,
    });
  }
  if (input.kind === "all_unspecified") return renderConversationMessage("first_entry.delivery_all_unspecified");
  if (input.kind === "selected_cities") {
    return renderConversationMessage("first_entry.delivery_selected_cities", { cities: input.cities });
  }
  if (input.kind === "excluded_cities") {
    return renderConversationMessage("first_entry.delivery_excluded_cities", { cities: input.cities });
  }
  if (input.kind === "by_city") return renderConversationMessage("first_entry.delivery_by_city");
  return renderConversationMessage("first_entry.delivery_unavailable");
}

export function firstEntryPaymentLine(paymentText: string): string {
  return renderConversationMessage("first_entry.payment_available", { paymentText });
}

export function firstEntryDeliveryWithIcon(deliveryText: string): string {
  return renderConversationMessage("first_entry.delivery_with_icon", { deliveryText });
}

export function firstEntryCtaQuestion(mode: FirstEntryCtaMode, style: GreetingStyle): string | undefined {
  if (mode === "none") return undefined;
  const professional = style === "professional";
  if (mode === "order_only") {
    return renderConversationMessage(professional
      ? "first_entry.cta_order_only_professional"
      : "first_entry.cta_order_only_friendly");
  }
  if (mode === "info_only") {
    return renderConversationMessage(professional
      ? "first_entry.cta_info_only_professional"
      : "first_entry.cta_info_only_friendly");
  }
  if (style === "short") return renderConversationMessage("first_entry.cta_both_short");
  return renderConversationMessage(professional
    ? "first_entry.cta_both_professional"
    : "first_entry.cta_both_friendly");
}
