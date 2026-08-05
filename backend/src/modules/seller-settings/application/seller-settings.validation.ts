import { normalizeIntendedWhatsappPhoneE164, normalizeLogoMetadata, normalizeWorkspaceDisplayName } from "../../seller-workspace-profile";
import { parseSellerCommerceConfig } from "../../seller-commerce-config";
import type { SellerCommerceConfigV1 } from "../../seller-commerce-config";
import type { SellerSettingsUpdateInput } from "./seller-settings.types";
import { SellerSettingsValidationError } from "./seller-settings.types";

type SellerSettingsStoreUpdate = NonNullable<SellerSettingsUpdateInput["store"]>;
type SellerSettingsContactUpdate = NonNullable<SellerSettingsStoreUpdate["contact"]>;
type SellerSettingsLogoUpdate = SellerSettingsStoreUpdate["logo"];

const FORBIDDEN_TOP_LEVEL = new Set([
  "sellerId",
  "workspaceId",
  "workspacePurpose",
  "role",
  "memberships",
  "products",
  "product",
  "prices",
  "options",
  "images",
  "conversation",
  "conversationConfig",
  "firstEntryPolicy",
  "interactive",
  "whatsapp",
  "connection",
  "connectionId",
  "credentials",
  "orders",
  "configVersion",
]);

const SUPPORTED_CUSTOMER_FIELDS = new Set(["fullName", "phone", "city", "address", "quantity"]);
const ALLOWED_FIELD_REQUIREMENTS = new Set(["REQUIRED", "OPTIONAL", "DISABLED", "CONDITIONAL"]);
const ALLOWED_CAPTURE_MODES = new Set(["CONFIGURED_ENUM", "OPEN_TEXT", "NUMERIC", "PHONE", "LOCATION", "ADDRESS", "CUSTOM"]);
const ALLOWED_ASK_POLICIES = new Set(["DO_NOT_ASK", "ASK_ONCE", "ASK_BEFORE_CONFIRMATION"]);

function record(issues: { field: string; code: string }[], field: string, code: string): void {
  issues.push({ field, code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: { field: string; code: string }[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) record(issues, path ? `${path}.${key}` : key, "UNKNOWN_PROPERTY");
  }
}

function optionalBoolean(value: unknown, field: string, issues: { field: string; code: string }[]): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    record(issues, field, "INVALID_BOOLEAN");
    return undefined;
  }
  return value;
}

function requiredBoolean(value: unknown, field: string, issues: { field: string; code: string }[]): boolean {
  if (typeof value !== "boolean") {
    record(issues, field, "INVALID_BOOLEAN");
    return false;
  }
  return value;
}

function optionalText(value: unknown, field: string, issues: { field: string; code: string }[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    record(issues, field, "INVALID_TEXT");
    return undefined;
  }
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > 240) {
    record(issues, field, "INVALID_TEXT");
    return undefined;
  }
  return normalized;
}

function minor(value: unknown, field: string, issues: { field: string; code: string }[]): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    record(issues, field, "INVALID_MINOR_UNITS");
    return undefined;
  }
  return value as number;
}

function nonEmptyStringArray(value: unknown, field: string, issues: { field: string; code: string }[]): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    record(issues, field, "INVALID_STRING_ARRAY");
    return undefined;
  }
  return value.map((entry) => entry.trim());
}

function parsePayment(value: unknown, issues: { field: string; code: string }[]): SellerCommerceConfigV1["payment"] | undefined {
  if (!isRecord(value)) {
    record(issues, "commerce.payment", "INVALID_OBJECT");
    return undefined;
  }
  rejectUnknown(value, ["method", "enabled"], "commerce.payment", issues);
  if (value.method !== "COD") record(issues, "commerce.payment.method", "UNSUPPORTED_PAYMENT_METHOD");
  const enabled = requiredBoolean(value.enabled, "commerce.payment.enabled", issues);
  return { method: "COD", enabled };
}

function parsePricing(value: unknown, issues: { field: string; code: string }[]): SellerCommerceConfigV1["delivery"]["pricing"] | undefined {
  if (!isRecord(value)) {
    record(issues, "commerce.delivery.pricing", "INVALID_OBJECT");
    return undefined;
  }
  rejectUnknown(value, ["mode", "currency", "flatRateMinor", "rules", "defaultRule"], "commerce.delivery.pricing", issues);
  if (!["ALL_FREE", "FLAT_RATE", "CITY_RULES"].includes(value.mode as string)) {
    record(issues, "commerce.delivery.pricing.mode", "UNSUPPORTED_DELIVERY_PRICING_MODE");
  }
  if (value.currency !== "MAD") record(issues, "commerce.delivery.pricing.currency", "UNSUPPORTED_CURRENCY");
  const flatRateMinor = minor(value.flatRateMinor, "commerce.delivery.pricing.flatRateMinor", issues);
  const rules = value.rules === undefined ? undefined : parseRules(value.rules, issues);
  const defaultRule = value.defaultRule === undefined ? undefined : parseDefaultRule(value.defaultRule, issues);
  return {
    mode: value.mode as SellerCommerceConfigV1["delivery"]["pricing"]["mode"],
    currency: "MAD",
    ...(flatRateMinor !== undefined ? { flatRateMinor } : {}),
    ...(rules !== undefined ? { rules } : {}),
    ...(defaultRule !== undefined ? { defaultRule } : {}),
  };
}

function parseRules(value: unknown, issues: { field: string; code: string }[]): SellerCommerceConfigV1["delivery"]["pricing"]["rules"] | undefined {
  if (!Array.isArray(value)) {
    record(issues, "commerce.delivery.pricing.rules", "INVALID_ARRAY");
    return undefined;
  }
  const seenRuleIds = new Set<string>();
  const seenCityKeys = new Set<string>();
  return value.map((rule, index) => {
    const path = `commerce.delivery.pricing.rules.${index}`;
    if (!isRecord(rule)) {
      record(issues, path, "INVALID_OBJECT");
      return { id: "", type: "FREE", cityKeys: [] };
    }
    rejectUnknown(rule, ["id", "type", "cityKeys", "aliases", "amountMinor", "priority"], path, issues);
    const id = optionalText(rule.id, `${path}.id`, issues) ?? "";
    if (id && seenRuleIds.has(id)) record(issues, `${path}.id`, "DUPLICATE_RULE_ID");
    seenRuleIds.add(id);
    if (!["FREE", "PAID", "UNAVAILABLE"].includes(rule.type as string)) record(issues, `${path}.type`, "UNKNOWN_RULE_TYPE");
    const cityKeys = nonEmptyStringArray(rule.cityKeys, `${path}.cityKeys`, issues) ?? [];
    for (const cityKey of cityKeys.map((entry) => entry.toLocaleLowerCase("en-US"))) {
      if (seenCityKeys.has(cityKey)) record(issues, `${path}.cityKeys`, "DUPLICATE_CITY_RULE");
      seenCityKeys.add(cityKey);
    }
    const aliases = rule.aliases === undefined ? undefined : nonEmptyStringArray(rule.aliases, `${path}.aliases`, issues);
    const amountMinor = minor(rule.amountMinor, `${path}.amountMinor`, issues);
    if (rule.priority !== undefined && !Number.isSafeInteger(rule.priority)) record(issues, `${path}.priority`, "INVALID_PRIORITY");
    return {
      id,
      type: rule.type as "FREE" | "PAID" | "UNAVAILABLE",
      cityKeys,
      ...(aliases !== undefined ? { aliases } : {}),
      ...(amountMinor !== undefined ? { amountMinor } : {}),
      ...(Number.isSafeInteger(rule.priority) ? { priority: rule.priority as number } : {}),
    };
  });
}

function parseDefaultRule(value: unknown, issues: { field: string; code: string }[]): SellerCommerceConfigV1["delivery"]["pricing"]["defaultRule"] | undefined {
  if (!isRecord(value)) {
    record(issues, "commerce.delivery.pricing.defaultRule", "INVALID_OBJECT");
    return undefined;
  }
  rejectUnknown(value, ["id", "type", "amountMinor"], "commerce.delivery.pricing.defaultRule", issues);
  if (!["FREE", "PAID", "UNAVAILABLE"].includes(value.type as string)) record(issues, "commerce.delivery.pricing.defaultRule.type", "UNKNOWN_RULE_TYPE");
  const id = optionalText(value.id, "commerce.delivery.pricing.defaultRule.id", issues);
  const amountMinor = minor(value.amountMinor, "commerce.delivery.pricing.defaultRule.amountMinor", issues);
  return {
    ...(id !== undefined ? { id } : {}),
    type: value.type as "FREE" | "PAID" | "UNAVAILABLE",
    ...(amountMinor !== undefined ? { amountMinor } : {}),
  };
}

function parseDelivery(value: unknown, issues: { field: string; code: string }[]): SellerCommerceConfigV1["delivery"] | undefined {
  if (!isRecord(value)) {
    record(issues, "commerce.delivery", "INVALID_OBJECT");
    return undefined;
  }
  rejectUnknown(value, ["enabled", "availability", "pricing"], "commerce.delivery", issues);
  const enabled = requiredBoolean(value.enabled, "commerce.delivery.enabled", issues);
  if (!["all_cities", "selected_cities", "excluded_cities", "not_available", "not_mentioned"].includes(value.availability as string)) {
    record(issues, "commerce.delivery.availability", "UNSUPPORTED_DELIVERY_AVAILABILITY");
  }
  const pricing = parsePricing(value.pricing, issues);
  return {
    enabled,
    availability: value.availability as SellerCommerceConfigV1["delivery"]["availability"],
    pricing: pricing ?? { mode: "ALL_FREE", currency: "MAD" },
  };
}

function parseRequiredFields(value: unknown, issues: { field: string; code: string }[]): SellerCommerceConfigV1["requiredCustomerFields"] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    record(issues, "commerce.requiredCustomerFields", "INVALID_ARRAY");
    return undefined;
  }
  const keys = new Set<string>();
  return value.map((field, index) => {
    const path = `commerce.requiredCustomerFields.${index}`;
    if (!isRecord(field)) {
      record(issues, path, "INVALID_OBJECT");
      return { key: "", label: "", required: false, enabled: false };
    }
    rejectUnknown(field, ["key", "label", "prompt", "required", "enabled", "askOrder", "minValue", "maxValue", "defaultValue", "requirement", "captureMode", "semanticType", "aliases", "allowMultipleMessages", "askPolicy", "condition"], path, issues);
    if (typeof field.key !== "string" || !SUPPORTED_CUSTOMER_FIELDS.has(field.key)) record(issues, `${path}.key`, "UNSUPPORTED_FIELD_KEY");
    if (typeof field.key === "string" && keys.has(field.key)) record(issues, `${path}.key`, "DUPLICATE_FIELD_KEY");
    if (typeof field.key === "string") keys.add(field.key);
    const label = optionalText(field.label, `${path}.label`, issues) ?? "";
    const prompt = optionalText(field.prompt, `${path}.prompt`, issues);
    const required = requiredBoolean(field.required, `${path}.required`, issues);
    const enabled = requiredBoolean(field.enabled, `${path}.enabled`, issues);
    if (field.askOrder !== undefined && (!Number.isSafeInteger(field.askOrder) || (field.askOrder as number) < 0)) record(issues, `${path}.askOrder`, "INVALID_ASK_ORDER");
    if (field.requirement !== undefined && !ALLOWED_FIELD_REQUIREMENTS.has(field.requirement as string)) record(issues, `${path}.requirement`, "UNSUPPORTED_REQUIREMENT");
    if (field.captureMode !== undefined && !ALLOWED_CAPTURE_MODES.has(field.captureMode as string)) record(issues, `${path}.captureMode`, "UNSUPPORTED_CAPTURE_MODE");
    if (field.askPolicy !== undefined && !ALLOWED_ASK_POLICIES.has(field.askPolicy as string)) record(issues, `${path}.askPolicy`, "UNSUPPORTED_ASK_POLICY");
    if (field.aliases !== undefined) nonEmptyStringArray(field.aliases, `${path}.aliases`, issues);
    if (field.minValue !== undefined && typeof field.minValue !== "number") record(issues, `${path}.minValue`, "INVALID_NUMBER");
    if (field.maxValue !== undefined && typeof field.maxValue !== "number") record(issues, `${path}.maxValue`, "INVALID_NUMBER");
    if (field.condition !== undefined && !isRecord(field.condition)) record(issues, `${path}.condition`, "INVALID_OBJECT");
    return {
      key: field.key as string,
      label,
      ...(prompt !== undefined ? { prompt } : {}),
      required,
      enabled,
      ...(Number.isSafeInteger(field.askOrder) ? { askOrder: field.askOrder as number } : {}),
      ...(typeof field.minValue === "number" ? { minValue: field.minValue } : {}),
      ...(typeof field.maxValue === "number" ? { maxValue: field.maxValue } : {}),
      ...(typeof field.defaultValue === "string" || typeof field.defaultValue === "number" ? { defaultValue: field.defaultValue } : {}),
      ...(typeof field.requirement === "string" ? { requirement: field.requirement as never } : {}),
      ...(typeof field.captureMode === "string" ? { captureMode: field.captureMode as never } : {}),
      ...(typeof field.semanticType === "string" ? { semanticType: field.semanticType } : {}),
      ...(Array.isArray(field.aliases) ? { aliases: field.aliases as string[] } : {}),
      ...(typeof field.allowMultipleMessages === "boolean" ? { allowMultipleMessages: field.allowMultipleMessages } : {}),
      ...(typeof field.askPolicy === "string" ? { askPolicy: field.askPolicy as never } : {}),
      ...(isRecord(field.condition) ? { condition: field.condition as never } : {}),
    };
  });
}

function parseOrderBehavior(value: unknown, issues: { field: string; code: string }[]): NonNullable<SellerSettingsUpdateInput["commerce"]>["orderBehavior"] | undefined {
  if (!isRecord(value)) {
    record(issues, "commerce.orderBehavior", "INVALID_OBJECT");
    return undefined;
  }
  rejectUnknown(value, ["multiItemOrderFlow"], "commerce.orderBehavior", issues);
  const flow = value.multiItemOrderFlow;
  if (!isRecord(flow)) {
    record(issues, "commerce.orderBehavior.multiItemOrderFlow", "INVALID_OBJECT");
    return undefined;
  }
  rejectUnknown(flow, ["enabled", "runtimeMode"], "commerce.orderBehavior.multiItemOrderFlow", issues);
  const enabled = requiredBoolean(flow.enabled, "commerce.orderBehavior.multiItemOrderFlow.enabled", issues);
  if (!["disabled", "dry_run", "guarded"].includes(flow.runtimeMode as string)) record(issues, "commerce.orderBehavior.multiItemOrderFlow.runtimeMode", "UNSUPPORTED_RUNTIME_MODE");
  return {
    multiItemOrderFlow: {
      enabled,
      runtimeMode: flow.runtimeMode as "disabled" | "dry_run" | "guarded",
    },
  };
}

function parseReceipt(value: unknown, issues: { field: string; code: string }[]): SellerCommerceConfigV1["receipt"] | undefined {
  if (!isRecord(value)) {
    record(issues, "commerce.receipt", "INVALID_OBJECT");
    return undefined;
  }
  rejectUnknown(value, ["enabled", "sendAfterConfirmation", "showLogo", "footerText", "paymentMethodLabel"], "commerce.receipt", issues);
  const enabled = requiredBoolean(value.enabled, "commerce.receipt.enabled", issues);
  const sendAfterConfirmation = requiredBoolean(value.sendAfterConfirmation, "commerce.receipt.sendAfterConfirmation", issues);
  const showLogo = optionalBoolean(value.showLogo, "commerce.receipt.showLogo", issues);
  const footerText = optionalText(value.footerText, "commerce.receipt.footerText", issues);
  const paymentMethodLabel = optionalText(value.paymentMethodLabel, "commerce.receipt.paymentMethodLabel", issues);
  return {
    enabled,
    sendAfterConfirmation,
    ...(showLogo !== undefined ? { showLogo } : {}),
    ...(footerText !== undefined ? { footerText } : {}),
    ...(paymentMethodLabel !== undefined ? { paymentMethodLabel } : {}),
  };
}

function parseCommerce(value: unknown, issues: { field: string; code: string }[]): SellerSettingsUpdateInput["commerce"] | undefined {
  if (!isRecord(value)) {
    record(issues, "commerce", "INVALID_OBJECT");
    return undefined;
  }
  rejectUnknown(value, ["payment", "delivery", "requiredCustomerFields", "orderBehavior", "receipt"], "commerce", issues);
  const payment = parsePayment(value.payment, issues);
  const delivery = parseDelivery(value.delivery, issues);
  const requiredCustomerFields = parseRequiredFields(value.requiredCustomerFields, issues);
  const orderBehavior = parseOrderBehavior(value.orderBehavior, issues);
  const receipt = parseReceipt(value.receipt, issues);
  const commerce = {
    configVersion: 1,
    payment,
    delivery,
    requiredCustomerFields,
    orderBehavior: orderBehavior ? {
      multiItemOrderFlow: {
        ...orderBehavior.multiItemOrderFlow,
        allowedSellerIds: [],
      },
    } : undefined,
    receipt,
  };
  try {
    parseSellerCommerceConfig(commerce);
    if (!payment || !delivery || !requiredCustomerFields || !orderBehavior || !receipt) return undefined;
    return { payment, delivery, requiredCustomerFields, orderBehavior, receipt };
  } catch {
    record(issues, "commerce", "INVALID_COMMERCE_CONFIG");
    return undefined;
  }
}

export function parseSellerSettingsUpdate(value: unknown, sellerId: string): SellerSettingsUpdateInput {
  const issues: { field: string; code: string }[] = [];
  if (!isRecord(value)) throw new SellerSettingsValidationError([{ field: "body", code: "INVALID_OBJECT" }]);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_TOP_LEVEL.has(key)) record(issues, key, "FORBIDDEN_PROPERTY");
  }
  rejectUnknown(value, ["store", "commerce"], "", issues);

  let store: SellerSettingsUpdateInput["store"];
  if (value.store !== undefined) {
    if (!isRecord(value.store)) {
      record(issues, "store", "INVALID_OBJECT");
    } else {
      rejectUnknown(value.store, ["businessName", "locale", "contact", "logo"], "store", issues);
      let businessName: string | undefined;
      if (value.store.businessName !== undefined) {
        try { businessName = normalizeWorkspaceDisplayName(value.store.businessName); } catch { record(issues, "store.businessName", "INVALID_BUSINESS_NAME"); }
      }
      if (value.store.locale !== undefined && value.store.locale !== "ar-MA") record(issues, "store.locale", "UNSUPPORTED_LOCALE");
      let contact: SellerSettingsContactUpdate | undefined;
      if (value.store.contact !== undefined) {
        if (!isRecord(value.store.contact)) {
          record(issues, "store.contact", "INVALID_OBJECT");
        } else {
          rejectUnknown(value.store.contact, ["intendedWhatsappPhoneE164"], "store.contact", issues);
          try {
            contact = {
              intendedWhatsappPhoneE164: normalizeIntendedWhatsappPhoneE164(value.store.contact.intendedWhatsappPhoneE164) ?? null,
            };
          } catch {
            record(issues, "store.contact.intendedWhatsappPhoneE164", "INVALID_PHONE");
          }
        }
      }
      let logo: SellerSettingsLogoUpdate | undefined;
      if (value.store.logo !== undefined) {
        if (value.store.logo === null) {
          logo = null;
        } else {
          try {
            const metadata = normalizeLogoMetadata(value.store.logo as never);
            if (!metadata || !metadata.objectKey.startsWith(`seller-logos/${sellerId}/`)) {
              record(issues, "store.logo.objectKey", "UNTRUSTED_MEDIA_REFERENCE");
            } else {
              logo = metadata;
            }
          } catch {
            record(issues, "store.logo", "INVALID_LOGO");
          }
        }
      }
      store = {
        ...(businessName !== undefined ? { businessName } : {}),
        ...(value.store.locale === "ar-MA" ? { locale: "ar-MA" as const } : {}),
        ...(contact !== undefined ? { contact } : {}),
        ...(value.store.logo !== undefined ? { logo } : {}),
      };
    }
  }

  const commerce = value.commerce === undefined ? undefined : parseCommerce(value.commerce, issues);
  if (issues.length) throw new SellerSettingsValidationError(issues);
  return {
    ...(store !== undefined ? { store } : {}),
    ...(commerce !== undefined ? { commerce } : {}),
  };
}
