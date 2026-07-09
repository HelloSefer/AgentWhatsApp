import { normalizeSellerConfig } from "./first-entry-config.service";
import type { ProductContext } from "./product-context.types";
import type {
  DeliveryPolicy,
  FirstEntryCtaMode,
  FirstEntryPolicy,
  GreetingStyle,
  SellerConfig,
} from "./seller-config.types";

export type FirstEntryRenderResult = {
  text: string;
  lines: string[];
  policy: FirstEntryPolicy;
  deliveryPolicy?: DeliveryPolicy;
  ctaMode: FirstEntryCtaMode;
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

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function containsUnsafeClaim(value: string): boolean {
  return unsafeCommercialClaims.some((claim) => value.includes(claim));
}

function getCurrencyLabel(currency: unknown): string {
  return currency === "MAD" ? "درهم" : cleanText(currency) || "درهم";
}

function hasPrice(productContext: ProductContext): boolean {
  return (
    typeof productContext.price === "number" &&
    Number.isFinite(productContext.price) &&
    productContext.price > 0
  );
}

function formatPrice(productContext: ProductContext): string | undefined {
  if (!hasPrice(productContext)) {
    return undefined;
  }

  return `${productContext.price} ${getCurrencyLabel(productContext.currency)}`;
}

function formatList(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join("، ");
}

function getProductNameLine(
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

  return `المنتج: ${productName}.`;
}

function buildOpeningLines(
  style: GreetingStyle,
  productNameLine: string | undefined,
): string[] {
  if (style === "professional") {
    return [
      "مرحباً بك.",
      "المنتج متوفر حالياً.",
      ...(productNameLine ? [productNameLine] : []),
    ];
  }

  if (style === "short") {
    return [
      "سلام 👋 المنتج متوفر.",
      ...(productNameLine ? [productNameLine] : []),
    ];
  }

  return [
    "سلام 👋",
    "مرحبا بك، المنتج متوفر حالياً.",
    ...(productNameLine ? [productNameLine] : []),
  ];
}

function renderDeliveryLine(
  deliveryPolicy: DeliveryPolicy | undefined,
  warnings: string[],
): string | undefined {
  if (!deliveryPolicy?.enabled || deliveryPolicy.availability === "not_mentioned") {
    return undefined;
  }

  if (deliveryPolicy.availability === "all_cities") {
    if (deliveryPolicy.isFree) {
      return "التوصيل مجاني ومتوفر لجميع المدن ✅";
    }

    if (deliveryPolicy.deliveryPrice !== undefined) {
      return `التوصيل متوفر لجميع المدن بثمن ${deliveryPolicy.deliveryPrice} ${getCurrencyLabel(deliveryPolicy.currency)}.`;
    }

    return "التوصيل متوفر لجميع المدن.";
  }

  if (deliveryPolicy.availability === "selected_cities") {
    const cities = Array.isArray(deliveryPolicy.cities)
      ? deliveryPolicy.cities.map((city) => city.trim()).filter(Boolean)
      : [];

    if (!cities.length) {
      warnings.push("selected_cities_missing");
      return undefined;
    }

    return `التوصيل متوفر حالياً في: ${formatList(cities)}.`;
  }

  if (deliveryPolicy.availability === "excluded_cities") {
    const excludedCities = Array.isArray(deliveryPolicy.excludedCities)
      ? deliveryPolicy.excludedCities
          .map((city) => city.trim())
          .filter(Boolean)
      : [];

    if (!excludedCities.length) {
      warnings.push("excluded_cities_missing");
      return "التوصيل متوفر حسب المدينة.";
    }

    return `التوصيل متوفر لجميع المدن ما عدا: ${formatList(excludedCities)}.`;
  }

  if (deliveryPolicy.availability === "not_available") {
    return "التوصيل غير متوفر حالياً.";
  }

  return undefined;
}

function renderPaymentLine(
  sellerConfig: SellerConfig,
  policy: FirstEntryPolicy,
): string | undefined {
  if (!policy.showPayment || !sellerConfig.delivery.paymentOnDelivery) {
    return undefined;
  }

  const paymentText =
    cleanText(sellerConfig.delivery.paymentText) || "الدفع عند الاستلام";

  return `${paymentText} متوفر.`;
}

function renderTrustLine(style: GreetingStyle): string {
  if (style === "professional") {
    return "يمكنك تأكيد تفاصيل الطلب قبل الإرسال.";
  }

  return "يمكنك تأكيد الطلب قبل الإرسال.";
}

function renderCtaLine(
  ctaMode: FirstEntryCtaMode,
  style: GreetingStyle,
): string | undefined {
  if (ctaMode === "none") {
    return undefined;
  }

  const professional = style === "professional";

  if (ctaMode === "order_only") {
    return professional
      ? "هل ترغب في إتمام الطلب الآن؟"
      : "بغيتي نوجد لك الطلب دابا؟";
  }

  if (ctaMode === "info_only") {
    return professional
      ? "هل ترغب في الاطلاع على المزيد من المعلومات؟"
      : "بغيتي تشوف معلومات أكثر على المنتج؟";
  }

  if (style === "short") {
    return "بغيتي تطلب دابا ولا تشوف معلومات أكثر؟";
  }

  return professional
    ? "هل ترغب في إتمام الطلب أم الاطلاع على المزيد من المعلومات؟"
    : "واش بغيتي دير الطلب دابا ولا تشوف معلومات أكثر؟";
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
    return {
      text: "",
      lines: [],
      policy,
      deliveryPolicy,
      ctaMode: policy.ctaMode,
      primaryCtaLabel: policy.primaryCtaLabel,
      secondaryCtaLabel: policy.secondaryCtaLabel,
      previewOnly: true,
      warnings: ["first_entry_disabled"],
    };
  }

  const productNameLine = getProductNameLine(
    input.productContext,
    policy.showProductName,
    warnings,
  );
  const lines = buildOpeningLines(policy.greetingStyle, productNameLine);

  if (policy.showPrice) {
    const priceText = formatPrice(input.productContext);

    if (priceText) {
      safePushLine(lines, `الثمن: ${priceText}.`);
    } else {
      warnings.push("price_missing");
    }
  } else if (showPriceRequested && !hasPrice(input.productContext)) {
    warnings.push("price_missing");
  }

  if (policy.showDelivery) {
    safePushLine(lines, renderDeliveryLine(deliveryPolicy, warnings));
  }

  safePushLine(lines, renderPaymentLine(sellerConfig, policy));

  if (policy.showPromotion && input.productContext.stock?.text) {
    safePushLine(lines, input.productContext.stock.text);
  }

  if (policy.showTrustLine) {
    safePushLine(lines, renderTrustLine(policy.greetingStyle));
  }

  const ctaLine = renderCtaLine(policy.ctaMode, policy.greetingStyle);

  if (ctaLine) {
    lines.push("");
    safePushLine(lines, ctaLine);
  }

  return {
    text: lines.join("\n").trim(),
    lines,
    policy,
    deliveryPolicy,
    ctaMode: policy.ctaMode,
    primaryCtaLabel: policy.primaryCtaLabel,
    secondaryCtaLabel: policy.secondaryCtaLabel,
    previewOnly: true,
    warnings,
  };
}
