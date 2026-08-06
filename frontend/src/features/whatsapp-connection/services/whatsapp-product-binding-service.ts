import { authenticatedBackendFetch, BackendHttpConfigurationError } from "@/lib/backend-http-client";
import type { WhatsAppCommerceReadinessReason, WhatsAppProductBindingResponse, WhatsAppProductBindingState } from "../types/whatsapp-product-binding-contracts";

export class WhatsAppProductBindingServiceError extends Error { constructor(readonly status: number, message: string) { super(message); this.name = "WhatsAppProductBindingServiceError"; } }
const reasons = new Set<WhatsAppCommerceReadinessReason>(["READY", "CONNECTION_NOT_ACTIVE", "CONNECTION_NOT_READY", "PRODUCT_UNBOUND", "PRODUCT_UNAVAILABLE", "COMMERCE_CONFIGURATION_REQUIRED", "CONVERSATION_CONFIGURATION_REQUIRED", "COMMERCE_CONFIGURATION_INVALID"]);
const states = new Set<WhatsAppProductBindingState>(["UNBOUND", "BOUND_AVAILABLE", "BOUND_UNAVAILABLE"]);
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function safeMessage(status: number): string {
  if (status === 401) return "Please sign in again to manage product binding.";
  if (status === 403) return "You do not have permission to manage product binding.";
  if (status === 404) return "This WhatsApp connection is no longer available.";
  if (status === 400) return "Product binding could not be saved. Try again.";
  return "Product binding is temporarily unavailable. Try again.";
}
function normalize(value: unknown): WhatsAppProductBindingResponse {
  const root = object(value); const binding = object(root.binding); const readiness = object(root.commerceReadiness);
  const connectionId = text(root.connectionId); const state = binding.state;
  const isUnbound = state === "UNBOUND";
  const productValue = isUnbound ? {} : object(binding.product);
  const productId = text(productValue.productId); const productName = text(productValue.name); const availability = productValue.availability;
  const reasonCode = readiness.reasonCode;
  if (!connectionId || !states.has(state as WhatsAppProductBindingState) || !reasons.has(reasonCode as WhatsAppCommerceReadinessReason) || typeof readiness.evaluated !== "boolean" || typeof readiness.ready !== "boolean" || (state === "UNBOUND" ? binding.product !== null : !productId || !productName || (availability !== "available" && availability !== "unavailable"))) throw new WhatsAppProductBindingServiceError(502, "Product binding returned an invalid response. Try again.");
  return { connectionId, binding: { state: state as WhatsAppProductBindingState, product: isUnbound ? null : { productId, name: productName, availability: availability as "available" | "unavailable" } }, commerceReadiness: { evaluated: readiness.evaluated, ready: readiness.ready, reasonCode: reasonCode as WhatsAppCommerceReadinessReason } };
}
async function request(path: string, init: RequestInit): Promise<WhatsAppProductBindingResponse> {
  let response: Response;
  try { response = await authenticatedBackendFetch(path, init); } catch (error) { throw new WhatsAppProductBindingServiceError(0, error instanceof BackendHttpConfigurationError ? "Product binding is not configured. Try again." : "Product binding is temporarily unavailable. Try again."); }
  if (!response.ok) throw new WhatsAppProductBindingServiceError(response.status, safeMessage(response.status));
  return normalize(await response.json().catch(() => undefined));
}
export const whatsappProductBindingService = {
  getProductBinding: (connectionId: string) => request(`/api/whatsapp-connections/${encodeURIComponent(connectionId)}/product-binding`, { method: "GET" }),
  bindProduct: (connectionId: string, productId: string) => request(`/api/whatsapp-connections/${encodeURIComponent(connectionId)}/product-binding`, { method: "PUT", body: JSON.stringify({ productId }) }),
  clearProductBinding: (connectionId: string) => request(`/api/whatsapp-connections/${encodeURIComponent(connectionId)}/product-binding`, { method: "DELETE" }),
};
