import type { SellerCommerceRuntimeProjectionResolution } from "../../../composition/runtime-read/seller-commerce-runtime-projection";
import type { WhatsAppConnectionProductBinding } from "../application/whatsapp-connection-product-binding.service";

export type WhatsAppConnectionProductBindingResponse = Readonly<{
  connectionId: string;
  binding: Readonly<{
    state: "UNBOUND" | "BOUND_AVAILABLE" | "BOUND_UNAVAILABLE";
    product: Readonly<{ productId: string; name: string; availability: "available" | "unavailable" }> | null;
  }>;
  commerceReadiness: Readonly<{
    evaluated: boolean;
    ready: boolean;
    reasonCode:
      | "READY"
      | "CONNECTION_NOT_ACTIVE"
      | "CONNECTION_NOT_READY"
      | "PRODUCT_UNBOUND"
      | "PRODUCT_UNAVAILABLE"
      | "COMMERCE_CONFIGURATION_REQUIRED"
      | "CONVERSATION_CONFIGURATION_REQUIRED"
      | "COMMERCE_CONFIGURATION_INVALID";
  }>;
}>;

function readiness(result: SellerCommerceRuntimeProjectionResolution): WhatsAppConnectionProductBindingResponse["commerceReadiness"] {
  if (result.status === "READY") return { evaluated: true, ready: true, reasonCode: "READY" };
  switch (result.readinessReason) {
    case "WHATSAPP_CONNECTION_REQUIRED":
    case "WHATSAPP_CONNECTION_INVALID":
      return { evaluated: true, ready: false, reasonCode: "CONNECTION_NOT_READY" };
    case "WHATSAPP_PRODUCT_BINDING_REQUIRED":
      return { evaluated: true, ready: false, reasonCode: "PRODUCT_UNBOUND" };
    case "WHATSAPP_PRODUCT_UNAVAILABLE":
      return { evaluated: true, ready: false, reasonCode: "PRODUCT_UNAVAILABLE" };
    case "SELLER_CONVERSATION_CONFIG_REQUIRED":
      return { evaluated: true, ready: false, reasonCode: "CONVERSATION_CONFIGURATION_REQUIRED" };
    case "SELLER_COMMERCE_CONFIG_REQUIRED":
      return { evaluated: true, ready: false, reasonCode: "COMMERCE_CONFIGURATION_REQUIRED" };
    default:
      return { evaluated: true, ready: false, reasonCode: "COMMERCE_CONFIGURATION_INVALID" };
  }
}

export function toWhatsAppConnectionProductBindingResponse(
  binding: WhatsAppConnectionProductBinding,
  commerce: SellerCommerceRuntimeProjectionResolution | null,
): WhatsAppConnectionProductBindingResponse {
  const product = binding.product;
  return {
    connectionId: binding.connection.connectionId,
    binding: product
      ? { state: product.availability === "available" ? "BOUND_AVAILABLE" : "BOUND_UNAVAILABLE", product }
      : { state: "UNBOUND", product: null },
    commerceReadiness: commerce
      ? readiness(commerce)
      : { evaluated: false, ready: false, reasonCode: "CONNECTION_NOT_ACTIVE" },
  };
}
