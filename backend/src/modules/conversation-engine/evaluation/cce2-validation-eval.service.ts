import { conversationConfigValidator } from "../config/conversation-config-validator.service";
import { CONVERSATION_CONFIG_SCHEMA_VERSION } from "../config/conversation-config.types";
import type { Cce2EvalCase } from "./cce2-eval.types";
import { cce2Report, check } from "./cce2-eval.types";

function value(key = "size_38", canonicalValue = "38", label = "38") {
  return { key, canonicalValue, label, enabled: true, available: true, order: 1 };
}

function option(outcome?: Record<string, string>) {
  return {
    key: "shoe_size",
    label: "المقاس",
    enabled: true,
    requirement: "required",
    order: 1,
    inputType: "list",
    promptMessageKey: "order.first_option_prompt",
    values: [{ ...value(), ...(outcome ? { outcome } : {}) }],
  };
}

export function evaluateCce2ConfigurationValidation() {
  const cases: Cce2EvalCase[] = [];
  const valid = conversationConfigValidator.validate({
    schemaVersion: CONVERSATION_CONFIG_SCHEMA_VERSION,
    locale: "ar-MA",
    messages: { "first_entry.commercial_intro": "مرحبا بك 👋" },
    options: [option()],
  });
  check(cases, "supported schema version is accepted", valid.valid, valid.errors);

  const unsupported = conversationConfigValidator.validate({ schemaVersion: 99 });
  check(cases, "unsupported schema version is rejected safely", !unsupported.valid && unsupported.errors.some((entry) => entry.code === "UNSUPPORTED_SCHEMA_VERSION"));

  const unknownToken = conversationConfigValidator.validate({
    schemaVersion: 1,
    messages: { "first_entry.product_with_price": "{{productFullName}} {{price}} {{unsafeToken}}" },
  });
  check(cases, "unknown message token is rejected", unknownToken.errors.some((entry) => entry.code === "UNKNOWN_TEMPLATE_TOKEN"));

  const missingToken = conversationConfigValidator.validate({
    schemaVersion: 1,
    messages: { "first_entry.product_with_price": "{{productFullName}}" },
  });
  check(cases, "missing required message token is rejected", missingToken.errors.some((entry) => entry.code === "MISSING_REQUIRED_TEMPLATE_TOKEN"));

  const safeOutcomes = conversationConfigValidator.validate({
    schemaVersion: 1,
    options: [option({ responseMessageKey: "order.item_ready", nextPresentationKey: "cart_review", domainActionKey: "CONTINUE_ORDER" })],
  });
  check(cases, "registered safe outcome keys are accepted", safeOutcomes.valid, safeOutcomes.errors);

  const unsafeOutcome = conversationConfigValidator.validate({
    schemaVersion: 1,
    options: [option({ domainActionKey: "executeArbitraryService" })],
  });
  check(cases, "unregistered domain outcome is rejected", unsafeOutcome.errors.some((entry) => entry.code === "UNREGISTERED_DOMAIN_ACTION"));

  const badOptionReference = conversationConfigValidator.validate({
    schemaVersion: 1,
    options: [option({ requestConfiguredOptionKey: "missing_option" })],
  });
  check(cases, "impossible next-option reference is rejected", badOptionReference.errors.some((entry) => entry.code === "UNKNOWN_OPTION_REFERENCE"));

  const circular = conversationConfigValidator.validate({
    schemaVersion: 1,
    lists: [
      { key: "cart_review", enabled: true, bodyMessageKey: "cart.review_ready", openingButtonLabel: "اختار", sections: [], outcome: { nextPresentationKey: "confirmation" } },
      { key: "confirmation", enabled: true, bodyMessageKey: "checkout.confirmation_question", openingButtonLabel: "اختار", sections: [], outcome: { nextPresentationKey: "cart_review" } },
    ],
  });
  check(cases, "circular next-presentation chain is rejected", circular.errors.some((entry) => entry.code === "CIRCULAR_PRESENTATION_CHAIN"));

  const partial = conversationConfigValidator.validate({
    schemaVersion: 1,
    messages: {
      "first_entry.commercial_intro": "مرحبا جديد",
      "unknown.message": "bad",
    },
  });
  check(cases, "one invalid field does not discard valid siblings", partial.normalizedConfig?.messages?.["first_entry.commercial_intro"] === "مرحبا جديد");
  check(cases, "validation returns structured fallback paths", partial.fallbackFields.includes("config.messages.unknown.message"));

  return cce2Report("CCE-2 configuration validation", cases);
}
