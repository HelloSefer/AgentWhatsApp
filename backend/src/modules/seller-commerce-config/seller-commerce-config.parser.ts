import type { CustomerFieldConfig } from "../agent/config/seller-config.types";
import { SellerCommerceConfigValidationError, type SellerCommerceConfigV1 } from "./seller-commerce-config.types";

const forbidden = new Set(["sellerId", "businessName", "languageStyle", "locale", "branding", "products", "prices", "options", "images", "interactive", "ai", "firstEntryPolicy", "connection", "credentials", "deliveryPolicy", "customerFields", "multiItemOrderFlow"]);
function fail(): never { throw new SellerCommerceConfigValidationError(); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { const obj = object(value); if (Object.keys(obj).length !== keys.length || keys.some((key) => !(key in obj))) return fail(); return obj; }
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) return fail(); return value; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") return fail(); return value; }
function minor(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) return fail(); return value as number; }
function optionalText(value: unknown): string | undefined { return value === undefined ? undefined : text(value); }
function stringArray(value: unknown): string[] { if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) return fail(); return [...value]; }
function field(value: unknown): CustomerFieldConfig {
  const v = object(value); const allowed = new Set(["key","label","prompt","required","enabled","askOrder","minValue","maxValue","defaultValue","requirement","captureMode","semanticType","aliases","allowMultipleMessages","askPolicy","condition"]);
  if (Object.keys(v).some((key) => !allowed.has(key)) || !text(v.key) || !text(v.label) || typeof v.required !== "boolean" || typeof v.enabled !== "boolean") return fail();
  if (v.askOrder !== undefined && (!Number.isSafeInteger(v.askOrder) || (v.askOrder as number) < 0)) return fail();
  return structuredClone(v) as CustomerFieldConfig;
}
function pricing(value: unknown): SellerCommerceConfigV1["delivery"]["pricing"] {
  const v = object(value); const allowed = new Set(["mode","currency","flatRateMinor","rules","defaultRule"]); if (Object.keys(v).some((key) => !allowed.has(key)) || !["ALL_FREE","FLAT_RATE","CITY_RULES"].includes(v.mode as string) || v.currency !== "MAD") return fail();
  if (v.flatRateMinor !== undefined) minor(v.flatRateMinor);
  if (v.rules !== undefined) { if (!Array.isArray(v.rules)) return fail(); for (const rule of v.rules) { const r = object(rule); const keys = new Set(["id","type","cityKeys","aliases","amountMinor","priority"]); if (Object.keys(r).some((key) => !keys.has(key)) || !text(r.id) || !["FREE","PAID","UNAVAILABLE"].includes(r.type as string) || !stringArray(r.cityKeys)) return fail(); if (r.aliases !== undefined) stringArray(r.aliases); if (r.amountMinor !== undefined) minor(r.amountMinor); if (r.priority !== undefined && !Number.isSafeInteger(r.priority)) return fail(); } }
  if (v.defaultRule !== undefined) { const r = object(v.defaultRule); if (Object.keys(r).some((key) => !["id","type","amountMinor"].includes(key)) || !["FREE","PAID","UNAVAILABLE"].includes(r.type as string)) return fail(); if (r.id !== undefined) text(r.id); if (r.amountMinor !== undefined) minor(r.amountMinor); }
  return structuredClone(v) as SellerCommerceConfigV1["delivery"]["pricing"];
}
export function parseSellerCommerceConfig(value: unknown): SellerCommerceConfigV1 {
  const root = exact(value, ["configVersion","payment","delivery","requiredCustomerFields","orderBehavior","receipt"]); if (Object.keys(root).some((key) => forbidden.has(key)) || root.configVersion !== 1) return fail();
  const payment = exact(root.payment, ["method","enabled"]); if (payment.method !== "COD") return fail(); bool(payment.enabled);
  const delivery = exact(root.delivery, ["enabled","availability","pricing"]); bool(delivery.enabled); if (!["all_cities","selected_cities","excluded_cities","not_available","not_mentioned"].includes(delivery.availability as string)) return fail(); pricing(delivery.pricing);
  if (!Array.isArray(root.requiredCustomerFields) || !root.requiredCustomerFields.length) return fail(); const fields = root.requiredCustomerFields.map(field); const keys = new Set<string>(); for (const item of fields) { if (keys.has(item.key)) return fail(); keys.add(item.key); }
  const behavior = exact(root.orderBehavior, ["multiItemOrderFlow"]); const flow = exact(behavior.multiItemOrderFlow, ["enabled","runtimeMode","allowedSellerIds"]); bool(flow.enabled); if (!["disabled","dry_run","guarded"].includes(flow.runtimeMode as string) || !Array.isArray(flow.allowedSellerIds) || flow.allowedSellerIds.some((id) => typeof id !== "string" || !id.trim())) return fail();
  const receipt = object(root.receipt); if (Object.keys(receipt).some((key) => !["enabled","sendAfterConfirmation","showLogo","footerText","paymentMethodLabel"].includes(key)) || !("enabled" in receipt) || !("sendAfterConfirmation" in receipt)) return fail(); bool(receipt.enabled); bool(receipt.sendAfterConfirmation); if (receipt.showLogo !== undefined) bool(receipt.showLogo); optionalText(receipt.footerText); optionalText(receipt.paymentMethodLabel);
  return structuredClone(root) as SellerCommerceConfigV1;
}
