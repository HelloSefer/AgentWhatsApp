export type WhatsAppProductBindingState = "UNBOUND" | "BOUND_AVAILABLE" | "BOUND_UNAVAILABLE";
export type WhatsAppCommerceReadinessReason = "READY" | "CONNECTION_NOT_ACTIVE" | "CONNECTION_NOT_READY" | "PRODUCT_UNBOUND" | "PRODUCT_UNAVAILABLE" | "COMMERCE_CONFIGURATION_REQUIRED" | "CONVERSATION_CONFIGURATION_REQUIRED" | "COMMERCE_CONFIGURATION_INVALID";
export type WhatsAppProductBindingResponse = Readonly<{
  connectionId: string;
  binding: Readonly<{ state: WhatsAppProductBindingState; product: Readonly<{ productId: string; name: string; availability: "available" | "unavailable" }> | null }>;
  commerceReadiness: Readonly<{ evaluated: boolean; ready: boolean; reasonCode: WhatsAppCommerceReadinessReason }>;
}>;
