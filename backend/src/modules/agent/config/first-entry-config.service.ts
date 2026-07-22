import type {
  DeliveryAvailability,
  DeliveryPolicy,
  DeliveryWordingStyle,
  FirstEntryCtaMode,
  FirstEntryPolicy,
  GreetingStyle,
  MultiItemOrderFlowConfig,
  MultiItemOrderRuntimeMode,
  SellerConfig,
} from "./seller-config.types";
import { firstEntryLabel } from "../../conversation-engine/adapters/first-entry-conversation.adapter";

type LegacyDeliveryConfig = SellerConfig["delivery"];

type SellerConfigInput = Omit<
  SellerConfig,
  "firstEntryPolicy" | "deliveryPolicy"
> & {
  firstEntryPolicy?: Partial<FirstEntryPolicy>;
  deliveryPolicy?: Partial<DeliveryPolicy>;
};

const defaultPrimaryCtaLabel = firstEntryLabel("first_entry.order_now");
const defaultSecondaryCtaLabel = firstEntryLabel("first_entry.more_info");

const validCtaModes: FirstEntryCtaMode[] = [
  "order_or_info",
  "order_only",
  "info_only",
  "none",
];

const validGreetingStyles: GreetingStyle[] = [
  "short",
  "friendly",
  "professional",
];

const validDeliveryAvailability: DeliveryAvailability[] = [
  "all_cities",
  "selected_cities",
  "excluded_cities",
  "not_available",
  "not_mentioned",
];

const validDeliveryWordingStyles: DeliveryWordingStyle[] = [
  "short",
  "clear",
  "professional",
];

const validMultiItemRuntimeModes: MultiItemOrderRuntimeMode[] = [
  "disabled",
  "dry_run",
  "guarded",
];

function hasProductPrice(productPrice: unknown): boolean {
  if (typeof productPrice === "number") {
    return Number.isFinite(productPrice) && productPrice > 0;
  }

  if (typeof productPrice === "string") {
    return Boolean(productPrice.trim());
  }

  return false;
}

function cleanLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanStringList(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const cleanedValues = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  return cleanedValues.length ? cleanedValues : undefined;
}

function cleanPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
}

function cleanCtaMode(value: unknown): FirstEntryCtaMode {
  return validCtaModes.includes(value as FirstEntryCtaMode)
    ? (value as FirstEntryCtaMode)
    : "order_or_info";
}

function cleanGreetingStyle(value: unknown): GreetingStyle {
  return validGreetingStyles.includes(value as GreetingStyle)
    ? (value as GreetingStyle)
    : "friendly";
}

function cleanDeliveryAvailability(value: unknown): DeliveryAvailability {
  return validDeliveryAvailability.includes(value as DeliveryAvailability)
    ? (value as DeliveryAvailability)
    : "all_cities";
}

function cleanDeliveryWordingStyle(value: unknown): DeliveryWordingStyle {
  return validDeliveryWordingStyles.includes(value as DeliveryWordingStyle)
    ? (value as DeliveryWordingStyle)
    : "clear";
}

export function normalizeMultiItemOrderFlow(
  value: Partial<MultiItemOrderFlowConfig> | undefined,
): MultiItemOrderFlowConfig {
  const runtimeMode = validMultiItemRuntimeModes.includes(
    value?.runtimeMode as MultiItemOrderRuntimeMode,
  )
    ? (value?.runtimeMode as MultiItemOrderRuntimeMode)
    : "disabled";
  const allowedSellerIds = cleanStringList(value?.allowedSellerIds);

  return {
    enabled: value?.enabled === true && runtimeMode !== "disabled",
    runtimeMode,
    ...(allowedSellerIds ? { allowedSellerIds } : {}),
  };
}

export function getDefaultFirstEntryPolicy(
  productPrice?: unknown,
): FirstEntryPolicy {
  return {
    enabled: true,
    showProductName: true,
    showPrice: hasProductPrice(productPrice),
    showDelivery: true,
    showPayment: true,
    showPromotion: false,
    showTrustLine: true,
    ctaMode: "order_or_info",
    greetingStyle: "friendly",
    primaryCtaLabel: defaultPrimaryCtaLabel,
    secondaryCtaLabel: defaultSecondaryCtaLabel,
  };
}

export function normalizeFirstEntryPolicy(
  policy?: Partial<FirstEntryPolicy>,
  productPrice?: unknown,
): FirstEntryPolicy {
  const defaults = getDefaultFirstEntryPolicy(productPrice);
  const productHasPrice = hasProductPrice(productPrice);

  return {
    enabled: policy?.enabled ?? defaults.enabled,
    showProductName: policy?.showProductName ?? defaults.showProductName,
    showPrice: productHasPrice
      ? (policy?.showPrice ?? defaults.showPrice)
      : false,
    showDelivery: policy?.showDelivery ?? defaults.showDelivery,
    showPayment: policy?.showPayment ?? defaults.showPayment,
    showPromotion: policy?.showPromotion ?? defaults.showPromotion,
    showTrustLine: policy?.showTrustLine ?? defaults.showTrustLine,
    ctaMode: cleanCtaMode(policy?.ctaMode ?? defaults.ctaMode),
    greetingStyle: cleanGreetingStyle(
      policy?.greetingStyle ?? defaults.greetingStyle,
    ),
    primaryCtaLabel: cleanLabel(
      policy?.primaryCtaLabel,
      defaultPrimaryCtaLabel,
    ),
    secondaryCtaLabel: cleanLabel(
      policy?.secondaryCtaLabel,
      defaultSecondaryCtaLabel,
    ),
  };
}

export function getDefaultDeliveryPolicy(
  legacyDelivery?: Partial<LegacyDeliveryConfig>,
): DeliveryPolicy {
  return {
    enabled: legacyDelivery?.enabled ?? true,
    availability: "all_cities",
    isFree: legacyDelivery?.free ?? false,
    deliveryPrice: cleanPositiveNumber(legacyDelivery?.deliveryPrice),
    currency: "MAD",
    wordingStyle: "clear",
  };
}

export function normalizeDeliveryPolicy(
  policy?: Partial<DeliveryPolicy>,
  legacyDelivery?: Partial<LegacyDeliveryConfig>,
): DeliveryPolicy {
  const defaults = getDefaultDeliveryPolicy(legacyDelivery);
  const availability = cleanDeliveryAvailability(
    policy?.availability ?? defaults.availability,
  );
  const deliveryPrice = cleanPositiveNumber(
    policy?.deliveryPrice ?? defaults.deliveryPrice,
  );
  const normalized: DeliveryPolicy = {
    enabled: policy?.enabled ?? defaults.enabled,
    availability,
    isFree: policy?.isFree ?? defaults.isFree,
    currency: policy?.currency ?? defaults.currency,
    wordingStyle: cleanDeliveryWordingStyle(
      policy?.wordingStyle ?? defaults.wordingStyle,
    ),
  };

  if (deliveryPrice !== undefined) {
    normalized.deliveryPrice = deliveryPrice;
  }

  if (availability === "selected_cities") {
    normalized.cities = cleanStringList(policy?.cities);
  }

  if (availability === "excluded_cities") {
    normalized.excludedCities = cleanStringList(policy?.excludedCities);
  }

  if (policy?.pricing) {
    normalized.pricing = {
      ...policy.pricing,
      rules: policy.pricing.rules?.map((rule) => ({
        ...rule,
        cityKeys: [...rule.cityKeys],
        aliases: rule.aliases ? [...rule.aliases] : undefined,
      })),
      defaultRule: policy.pricing.defaultRule
        ? { ...policy.pricing.defaultRule }
        : undefined,
    };
  } else if (normalized.isFree) {
    normalized.pricing = {
      enabled: true,
      mode: "ALL_FREE",
      currency: "MAD",
    };
  } else if (normalized.deliveryPrice !== undefined) {
    normalized.pricing = {
      enabled: true,
      mode: "FLAT_RATE",
      flatRate: normalized.deliveryPrice,
      currency: "MAD",
    };
  }

  return normalized;
}

export function normalizeSellerConfig(
  sellerConfig: SellerConfigInput,
  productPrice?: unknown,
): SellerConfig {
  return {
    ...sellerConfig,
    firstEntryPolicy: normalizeFirstEntryPolicy(
      sellerConfig.firstEntryPolicy,
      productPrice,
    ),
    deliveryPolicy: normalizeDeliveryPolicy(
      sellerConfig.deliveryPolicy,
      sellerConfig.delivery,
    ),
    multiItemOrderFlow: normalizeMultiItemOrderFlow(
      sellerConfig.multiItemOrderFlow,
    ),
  };
}
