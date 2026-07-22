import { normalizeSellerConfig } from "./first-entry-config.service";
import type { ProductContext } from "./product-context.types";
import type { AgentReplyUiHint } from "../reply/reply-renderer.types";
import type {
  DeliveryPolicy,
  FirstEntryCtaMode,
  FirstEntryPolicy,
  GreetingStyle,
  SellerConfig,
} from "./seller-config.types";
import {
  firstEntryCommercialIntro,
  firstEntryCtaQuestion,
  firstEntryDeliveryWithIcon,
  firstEntryDeliveryLine,
  firstEntryLabel,
  firstEntryPaymentLine,
  firstEntryProductLine,
} from "../../conversation-engine/adapters/first-entry-conversation.adapter";
import { commonLabel } from "../../conversation-engine/adapters/common-conversation.adapter";

export type FirstEntryCtaKind = "order" | "info";

export type FirstEntryCtaId =
  | "first_entry:order_now"
  | "first_entry:more_info";

export type FirstEntryCtaItem = {
  id: FirstEntryCtaId;
  label: string;
  kind: FirstEntryCtaKind;
  enabled: boolean;
};

export type FirstEntryCtaPreview = {
  mode: FirstEntryCtaMode;
  items: FirstEntryCtaItem[];
  previewOnly: true;
};

export type FirstEntryUiHintsPreview = {
  preferred: "buttons" | "none";
  buttons: Array<{
    id: FirstEntryCtaId;
    title: string;
  }>;
  replyUi: AgentReplyUiHint;
  previewOnly: true;
};

export type FirstEntryRenderResult = {
  text: string;
  lines: string[];
  policy: FirstEntryPolicy;
  deliveryPolicy?: DeliveryPolicy;
  ctaMode: FirstEntryCtaMode;
  ctas: FirstEntryCtaPreview;
  uiHints: FirstEntryUiHintsPreview;
  primaryCtaLabel?: string;
  secondaryCtaLabel?: string;
  previewOnly: true;
  warnings?: string[];
};

type RenderInput = {
  sellerConfig: SellerConfig;
  productContext: ProductContext;
};

const unsafeCommercialClaims = [
  "يعالج",
  "يشفي",
  "مضمون 100%",
  "نتيجة مضمونة",
  "علاج نهائي",
];

const defaultPrimaryCtaLabel = firstEntryLabel("first_entry.order_now");
const defaultSecondaryCtaLabel = firstEntryLabel("first_entry.more_info");

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function containsUnsafeClaim(value: string): boolean {
  return unsafeCommercialClaims.some((claim) => value.includes(claim));
}

function getCurrencyLabel(currency: unknown): string {
  return currency === "MAD"
    ? commonLabel("common.currency_mad")
    : cleanText(currency) || commonLabel("common.currency_mad");
}

function hasPrice(productContext: ProductContext): boolean {
  return (
    typeof productContext.price === "number" &&
    Number.isFinite(productContext.price) &&
    productContext.price > 0
  );
}

export function formatFirstEntryPrice(
  productContext: ProductContext,
): string | undefined {
  if (!hasPrice(productContext)) {
    return undefined;
  }

  return `${productContext.price} ${getCurrencyLabel(productContext.currency)}`;
}

function formatList(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join("، ");
}

function getProductName(
  productContext: ProductContext,
  showProductName: boolean,
  warnings: string[],
): string | undefined {
  const productName = cleanText(productContext.name);

  if (!showProductName || !productName) {
    return undefined;
  }

  if (containsUnsafeClaim(productName)) {
    warnings.push("unsafe_product_name_hidden");
    return undefined;
  }

  return productName;
}

export function renderFirstEntryDeliveryLine(
  deliveryPolicy: DeliveryPolicy | undefined,
  warnings: string[],
): string | undefined {
  if (!deliveryPolicy?.enabled || deliveryPolicy.availability === "not_mentioned") {
    return undefined;
  }

  if (deliveryPolicy.availability === "all_cities") {
    if (deliveryPolicy.isFree) {
      return firstEntryDeliveryLine({ kind: "all_free" });
    }

    if (deliveryPolicy.deliveryPrice !== undefined) {
      return firstEntryDeliveryLine({
        kind: "all_paid",
        deliveryAmount: deliveryPolicy.deliveryPrice,
        currency: getCurrencyLabel(deliveryPolicy.currency),
      });
    }

    return firstEntryDeliveryLine({ kind: "all_unspecified" });
  }

  if (deliveryPolicy.availability === "selected_cities") {
    const cities = Array.isArray(deliveryPolicy.cities)
      ? deliveryPolicy.cities.map((city) => city.trim()).filter(Boolean)
      : [];

    if (!cities.length) {
      warnings.push("selected_cities_missing");
      return undefined;
    }

    return firstEntryDeliveryLine({ kind: "selected_cities", cities: formatList(cities) });
  }

  if (deliveryPolicy.availability === "excluded_cities") {
    const excludedCities = Array.isArray(deliveryPolicy.excludedCities)
      ? deliveryPolicy.excludedCities
          .map((city) => city.trim())
          .filter(Boolean)
      : [];

    if (!excludedCities.length) {
      warnings.push("excluded_cities_missing");
      return firstEntryDeliveryLine({ kind: "by_city" });
    }

    return firstEntryDeliveryLine({ kind: "excluded_cities", cities: formatList(excludedCities) });
  }

  if (deliveryPolicy.availability === "not_available") {
    return firstEntryDeliveryLine({ kind: "unavailable" });
  }

  return undefined;
}

export function renderFirstEntryPaymentLine(
  sellerConfig: SellerConfig,
  policy: FirstEntryPolicy,
): string | undefined {
  if (!policy.showPayment || !sellerConfig.delivery.paymentOnDelivery) {
    return undefined;
  }

  const paymentText =
    cleanText(sellerConfig.delivery.paymentText) || firstEntryLabel("first_entry.payment_cod");

  return firstEntryPaymentLine(paymentText);
}

export function renderFirstEntryCtaLine(
  ctaMode: FirstEntryCtaMode,
  style: GreetingStyle,
): string | undefined {
  return firstEntryCtaQuestion(ctaMode, style);
}

function cleanCtaLabel(value: unknown, fallback: string): string {
  const label = cleanText(value);

  return label || fallback;
}

function buildCtaItem(input: {
  id: FirstEntryCtaId;
  label: string;
  kind: FirstEntryCtaKind;
}): FirstEntryCtaItem {
  return {
    id: input.id,
    label: input.label,
    kind: input.kind,
    enabled: true,
  };
}

export function buildFirstEntryCtaPreview(
  policy: FirstEntryPolicy,
): FirstEntryCtaPreview {
  const configuredPrimaryLabel = firstEntryLabel("first_entry.order_now");
  const configuredSecondaryLabel = firstEntryLabel("first_entry.more_info");
  const primaryLabel = cleanCtaLabel(
    configuredPrimaryLabel !== defaultPrimaryCtaLabel
      ? configuredPrimaryLabel
      : policy.primaryCtaLabel,
    defaultPrimaryCtaLabel,
  );
  const secondaryLabel = cleanCtaLabel(
    configuredSecondaryLabel !== defaultSecondaryCtaLabel
      ? configuredSecondaryLabel
      : policy.secondaryCtaLabel,
    defaultSecondaryCtaLabel,
  );

  if (policy.ctaMode === "none") {
    return {
      mode: policy.ctaMode,
      items: [],
      previewOnly: true,
    };
  }

  if (policy.ctaMode === "order_only") {
    return {
      mode: policy.ctaMode,
      items: [
        buildCtaItem({
          id: "first_entry:order_now",
          label: primaryLabel,
          kind: "order",
        }),
      ],
      previewOnly: true,
    };
  }

  if (policy.ctaMode === "info_only") {
    return {
      mode: policy.ctaMode,
      items: [
        buildCtaItem({
          id: "first_entry:more_info",
          label: secondaryLabel,
          kind: "info",
        }),
      ],
      previewOnly: true,
    };
  }

  return {
    mode: policy.ctaMode,
    items: [
      buildCtaItem({
        id: "first_entry:order_now",
        label: primaryLabel,
        kind: "order",
      }),
      buildCtaItem({
        id: "first_entry:more_info",
        label: secondaryLabel,
        kind: "info",
      }),
    ],
    previewOnly: true,
  };
}

export function buildFirstEntryUiHintsPreview(
  ctas: FirstEntryCtaPreview,
  body: string,
): FirstEntryUiHintsPreview {
  const buttons = ctas.items.map((item) => ({
    id: item.id,
    title: item.label,
  }));
  const options = ctas.items.map((item) => ({
    id: item.id,
    label: item.label,
    value: item.kind,
  }));

  return {
    preferred: buttons.length ? "buttons" : "none",
    buttons,
    replyUi: {
      kind: buttons.length ? "buttons" : "none",
      purpose: "first_entry",
      title: firstEntryLabel("first_entry.choice_title"),
      body,
      options,
      previewOnly: true,
    },
    previewOnly: true,
  };
}

function safePushLine(lines: string[], line: string | undefined): void {
  const cleanLine = cleanText(line);

  if (cleanLine && !containsUnsafeClaim(cleanLine)) {
    lines.push(cleanLine);
  }
}

export function renderFirstEntryMessage(
  input: RenderInput,
): FirstEntryRenderResult {
  const showPriceRequested = input.sellerConfig.firstEntryPolicy.showPrice;
  const sellerConfig = normalizeSellerConfig(
    input.sellerConfig,
    input.productContext.price,
  );
  const policy = sellerConfig.firstEntryPolicy;
  const deliveryPolicy = sellerConfig.deliveryPolicy;
  const warnings: string[] = [];

  if (!policy.enabled) {
    const ctas = buildFirstEntryCtaPreview(policy);

    return {
      text: "",
      lines: [],
      policy,
      deliveryPolicy,
      ctaMode: policy.ctaMode,
      ctas,
      uiHints: buildFirstEntryUiHintsPreview(ctas, ""),
      primaryCtaLabel: policy.primaryCtaLabel,
      secondaryCtaLabel: policy.secondaryCtaLabel,
      previewOnly: true,
      warnings: ["first_entry_disabled"],
    };
  }

  const productName = getProductName(
    input.productContext,
    policy.showProductName,
    warnings,
  );
  const lines = [firstEntryCommercialIntro()];
  const priceText = policy.showPrice
    ? formatFirstEntryPrice(input.productContext)
    : undefined;
  const deliveryLine = policy.showDelivery
    ? renderFirstEntryDeliveryLine(deliveryPolicy, warnings)
    : undefined;

  const productLine = firstEntryProductLine({ productFullName: productName, price: priceText });
  if (productLine) lines.push("", productLine);

  if (policy.showPrice && !priceText) {
    warnings.push("price_missing");
  } else if (showPriceRequested && !hasPrice(input.productContext)) {
    warnings.push("price_missing");
  }

  if (deliveryLine) {
    safePushLine(lines, firstEntryDeliveryWithIcon(deliveryLine));
  }

  const ctaLine = renderFirstEntryCtaLine(
    policy.ctaMode,
    policy.greetingStyle,
  );

  if (ctaLine) {
    lines.push("");
    safePushLine(lines, ctaLine);
  }

  const text = lines.join("\n").trim();
  const ctas = buildFirstEntryCtaPreview(policy);

  return {
    text,
    lines,
    policy,
    deliveryPolicy,
    ctaMode: policy.ctaMode,
    ctas,
    uiHints: buildFirstEntryUiHintsPreview(ctas, text),
    primaryCtaLabel: policy.primaryCtaLabel,
    secondaryCtaLabel: policy.secondaryCtaLabel,
    previewOnly: true,
    warnings,
  };
}
