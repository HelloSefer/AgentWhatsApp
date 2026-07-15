import type {
  DeliveryDefaultRule,
  DeliveryPriceRule,
  DeliveryPricingConfig,
} from "../config/seller-config.types";
import type { ProductContext } from "../product-context.types";

export type ResolvedDeliveryQuote = {
  status: "RESOLVED";
  type: "FREE" | "PAID";
  amount: number;
  currency: string;
  inputCity: string;
  canonicalCity?: string;
  ruleId?: string;
  resolvedAt: string;
};

export type UnavailableDeliveryQuote = {
  status: "UNAVAILABLE";
  type: "UNAVAILABLE";
  inputCity: string;
  canonicalCity?: string;
  ruleId?: string;
  reason: "RULE_MATCH" | "DEFAULT_RULE" | "CONFIG_INVALID";
  resolvedAt: string;
};

export type DeliveryQuote = ResolvedDeliveryQuote | UnavailableDeliveryQuote;

export type DeliveryPricingReadiness = {
  ready: boolean;
  reasons: string[];
};

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDeliveryCityKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateRuleAmount(
  rule: Pick<DeliveryPriceRule | DeliveryDefaultRule, "type" | "amount">,
  path: string,
  reasons: string[],
) {
  if (rule.type === "PAID" && !isFiniteNonNegative(rule.amount)) {
    reasons.push(`${path}.amount must be a non-negative finite number for PAID.`);
  }

  if (
    (rule.type === "FREE" || rule.type === "UNAVAILABLE") &&
    rule.amount !== undefined &&
    (!isFiniteNonNegative(rule.amount) || rule.amount !== 0)
  ) {
    reasons.push(`${path}.amount must be omitted or zero for ${rule.type}.`);
  }
}

export function validateDeliveryPricingConfig(
  config: DeliveryPricingConfig | undefined,
): DeliveryPricingReadiness {
  const reasons: string[] = [];

  if (!config?.enabled) {
    return {
      ready: false,
      reasons: ["deliveryPolicy.pricing.enabled must be true."],
    };
  }

  if (!["ALL_FREE", "FLAT_RATE", "CITY_RULES"].includes(config.mode)) {
    reasons.push("deliveryPolicy.pricing.mode is invalid.");
  }

  if (config.currency !== "MAD") {
    reasons.push("deliveryPolicy.pricing.currency must be MAD.");
  }

  if (config.mode === "FLAT_RATE" && !isFiniteNonNegative(config.flatRate)) {
    reasons.push("deliveryPolicy.pricing.flatRate must be a non-negative finite number.");
  }

  if (config.mode === "CITY_RULES") {
    const rules = Array.isArray(config.rules) ? config.rules : [];

    if (!rules.length) {
      reasons.push("deliveryPolicy.pricing.rules must contain at least one rule.");
    }

    if (!config.defaultRule) {
      reasons.push("deliveryPolicy.pricing.defaultRule is required for CITY_RULES.");
    } else {
      validateRuleAmount(config.defaultRule, "deliveryPolicy.pricing.defaultRule", reasons);
    }

    const seenRuleIds = new Set<string>();
    const seenKeysByPriority = new Map<string, string>();

    rules.forEach((rule, index) => {
      const path = `deliveryPolicy.pricing.rules[${index}]`;
      const ruleId = cleanText(rule.id);
      const cityValues = [...(rule.cityKeys || []), ...(rule.aliases || [])]
        .map((value) => normalizeDeliveryCityKey(value))
        .filter(Boolean);
      const priority = Number.isFinite(rule.priority) ? Number(rule.priority) : 0;

      if (!ruleId) {
        reasons.push(`${path}.id is required.`);
      } else if (seenRuleIds.has(ruleId)) {
        reasons.push(`${path}.id duplicates another rule id.`);
      } else {
        seenRuleIds.add(ruleId);
      }

      if (!["FREE", "PAID", "UNAVAILABLE"].includes(rule.type)) {
        reasons.push(`${path}.type is invalid.`);
      }

      if (!cityValues.length) {
        reasons.push(`${path} must define at least one city key or alias.`);
      }

      validateRuleAmount(rule, path, reasons);

      for (const cityKey of new Set(cityValues)) {
        const uniquenessKey = `${priority}:${cityKey}`;
        const existingRuleId = seenKeysByPriority.get(uniquenessKey);

        if (existingRuleId && existingRuleId !== ruleId) {
          reasons.push(
            `${path} conflicts with rule ${existingRuleId} for city key "${cityKey}" at priority ${priority}.`,
          );
        } else {
          seenKeysByPriority.set(uniquenessKey, ruleId || path);
        }
      }
    });
  }

  return {
    ready: reasons.length === 0,
    reasons,
  };
}

function resolvedQuote(input: {
  type: "FREE" | "PAID";
  amount: number;
  currency: string;
  inputCity: string;
  canonicalCity?: string;
  ruleId?: string;
}): ResolvedDeliveryQuote {
  return {
    status: "RESOLVED",
    type: input.type,
    amount: input.type === "FREE" ? 0 : input.amount,
    currency: input.currency,
    inputCity: input.inputCity,
    canonicalCity: input.canonicalCity,
    ruleId: input.ruleId,
    resolvedAt: new Date().toISOString(),
  };
}

function unavailableQuote(input: {
  inputCity: string;
  canonicalCity?: string;
  ruleId?: string;
  reason: UnavailableDeliveryQuote["reason"];
}): UnavailableDeliveryQuote {
  return {
    status: "UNAVAILABLE",
    type: "UNAVAILABLE",
    inputCity: input.inputCity,
    canonicalCity: input.canonicalCity,
    ruleId: input.ruleId,
    reason: input.reason,
    resolvedAt: new Date().toISOString(),
  };
}

function quoteFromRule(input: {
  rule: DeliveryPriceRule | DeliveryDefaultRule;
  currency: string;
  inputCity: string;
  canonicalCity?: string;
  ruleId?: string;
  unavailableReason: "RULE_MATCH" | "DEFAULT_RULE";
}): DeliveryQuote {
  if (input.rule.type === "UNAVAILABLE") {
    return unavailableQuote({
      inputCity: input.inputCity,
      canonicalCity: input.canonicalCity,
      ruleId: input.ruleId,
      reason: input.unavailableReason,
    });
  }

  return resolvedQuote({
    type: input.rule.type,
    amount: input.rule.type === "FREE" ? 0 : Number(input.rule.amount),
    currency: input.currency,
    inputCity: input.inputCity,
    canonicalCity: input.canonicalCity,
    ruleId: input.ruleId,
  });
}

export function resolveDeliveryQuote(input: {
  city: string;
  config?: DeliveryPricingConfig;
}): DeliveryQuote {
  const inputCity = cleanText(input.city);
  const readiness = validateDeliveryPricingConfig(input.config);

  if (!readiness.ready || !input.config) {
    return unavailableQuote({
      inputCity,
      canonicalCity: inputCity || undefined,
      ruleId: "delivery-config-invalid",
      reason: "CONFIG_INVALID",
    });
  }

  const config = input.config;

  if (config.mode === "ALL_FREE") {
    return resolvedQuote({
      type: "FREE",
      amount: 0,
      currency: config.currency,
      inputCity,
      canonicalCity: inputCity || undefined,
      ruleId: "all-cities-free",
    });
  }

  if (config.mode === "FLAT_RATE") {
    const amount = Number(config.flatRate);

    return resolvedQuote({
      type: amount === 0 ? "FREE" : "PAID",
      amount,
      currency: config.currency,
      inputCity,
      canonicalCity: inputCity || undefined,
      ruleId: "all-cities-flat-rate",
    });
  }

  const normalizedCity = normalizeDeliveryCityKey(inputCity);
  const matchingRule = [...(config.rules || [])]
    .sort((left, right) => (right.priority || 0) - (left.priority || 0))
    .find((rule) =>
      [...(rule.cityKeys || []), ...(rule.aliases || [])]
        .map(normalizeDeliveryCityKey)
        .includes(normalizedCity),
    );

  if (matchingRule) {
    return quoteFromRule({
      rule: matchingRule,
      currency: config.currency,
      inputCity,
      canonicalCity: cleanText(matchingRule.cityKeys?.[0]) || inputCity,
      ruleId: matchingRule.id,
      unavailableReason: "RULE_MATCH",
    });
  }

  const defaultRule = config.defaultRule as DeliveryDefaultRule;

  return quoteFromRule({
    rule: defaultRule,
    currency: config.currency,
    inputCity,
    canonicalCity: inputCity || undefined,
    ruleId: defaultRule.id || `default-${defaultRule.type.toLowerCase()}`,
    unavailableReason: "DEFAULT_RULE",
  });
}

export function resolveProductDeliveryQuote(input: {
  city: string;
  productContext: ProductContext;
}): DeliveryQuote {
  const explicitConfig = input.productContext.deliveryPricing;
  const legacyConfig: DeliveryPricingConfig | undefined = explicitConfig
    ? undefined
    : input.productContext.deliveryIsFree === true
      ? {
          enabled: true,
          mode: "ALL_FREE",
          currency: "MAD",
        }
      : typeof input.productContext.deliveryPrice === "number"
        ? {
            enabled: true,
            mode: "FLAT_RATE",
            currency: "MAD",
            flatRate: input.productContext.deliveryPrice,
          }
        : undefined;

  return resolveDeliveryQuote({
    city: input.city,
    config: explicitConfig || legacyConfig,
  });
}
