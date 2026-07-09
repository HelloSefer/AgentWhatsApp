import { evaluateFirstEntryEligibility } from "./first-entry-eligibility.service";
import { normalizeSellerConfig } from "./first-entry-config.service";
import {
  formatFirstEntryPrice,
  renderFirstEntryCtaLine,
  renderFirstEntryDeliveryLine,
  renderFirstEntryMessage,
  renderFirstEntryPaymentLine,
  type FirstEntryCtaPreview,
  type FirstEntryRenderResult,
  type FirstEntryUiHintsPreview,
} from "./first-entry-renderer.service";
import type { FirstEntryEligibilityResult } from "./first-entry-eligibility.service";
import type { ProductContext } from "./product-context.types";
import type { SellerConfig } from "./seller-config.types";

export type FirstEntryLeadIntent =
  | "greeting"
  | "price"
  | "order"
  | "info"
  | "media"
  | "availability"
  | "delivery"
  | "payment"
  | "unknown";

export type FirstEntryIntentConfidence = "high" | "medium" | "low";

export type FirstEntryRecommendedNextStep =
  | "show_first_entry"
  | "handoff_order_path_preview"
  | "handoff_info_path_preview"
  | "handoff_media_info_preview"
  | "answer_price_then_cta_preview"
  | "answer_availability_then_cta_preview"
  | "answer_delivery_then_cta_preview"
  | "answer_payment_then_cta_preview"
  | "do_not_show_first_entry";

export type FirstEntryIntentAnalysis = {
  intent: FirstEntryLeadIntent;
  confidence: FirstEntryIntentConfidence;
  normalizedText: string;
  matchedPattern?: string;
  extractedEntities?: {
    size?: string;
    color?: string;
    quantity?: number;
    city?: string;
  };
  previewOnly: true;
};

export type IntentAwareFirstEntryPreviewResult = {
  previewOnly: true;
  intent: FirstEntryIntentAnalysis;
  eligibility: FirstEntryEligibilityResult;
  renderResult: FirstEntryRenderResult;
  recommendedNextStep: FirstEntryRecommendedNextStep;
  text: string;
  ctas?: FirstEntryCtaPreview;
  uiHints?: FirstEntryUiHintsPreview;
  warnings?: string[];
};

type IntentAwareFirstEntryPreviewInput = {
  sellerConfig: SellerConfig;
  productContext: ProductContext;
  customerMessage: string;
  session?: unknown;
  orderState?: unknown;
};

const intentPatterns: Array<{
  intent: FirstEntryLeadIntent;
  confidence: FirstEntryIntentConfidence;
  patterns: string[];
}> = [
  {
    intent: "payment",
    confidence: "high",
    patterns: [
      "الدفع عند الاستلام",
      "cash on delivery",
      "paiement",
      "payment",
      "cod",
      "الدفع",
      "نخلص",
      "خلص",
    ],
  },
  {
    intent: "delivery",
    confidence: "high",
    patterns: [
      "wach livraison",
      "التوصيل كاين",
      "livraison",
      "delivery",
      "التوصيل",
      "توصيل",
    ],
  },
  {
    intent: "media",
    confidence: "high",
    patterns: [
      "بغيت الصور",
      "الصور",
      "تصاور",
      "صور",
      "tsawr",
      "swr",
      "photos",
      "pictures",
      "images",
      "image",
    ],
  },
  {
    intent: "price",
    confidence: "high",
    patterns: [
      "شحال الثمن",
      "ch7al taman",
      "شحال",
      "الثمن",
      "taman",
      "chhal",
      "ch7al",
      "price",
      "prix",
      "combien",
    ],
  },
  {
    intent: "info",
    confidence: "high",
    patterns: [
      "بغيت معلومات",
      "شنو التفاصيل",
      "عطيني معلومات",
      "معلومات",
      "التفاصيل",
      "details",
      "info",
    ],
  },
  {
    intent: "order",
    confidence: "high",
    patterns: [
      "بغيت نكوموندي",
      "بغيت نكومندي",
      "بغيت نطلب",
      "بغيت واحد",
      "بغيت وحدة",
      "bghit ncommander",
      "bghit ncommandi",
      "bghit nkmandi",
      "bghit wa7d",
      "bghit wahd",
      "bghit wahda",
      "نطلب",
      "commande",
      "order",
    ],
  },
  {
    intent: "availability",
    confidence: "high",
    patterns: [
      "واش متوفر",
      "واش كاين",
      "wach kayn",
      "متوفر",
      "disponible",
      "available",
      "stock",
      "kayn",
      "كاين",
    ],
  },
  {
    intent: "greeting",
    confidence: "high",
    patterns: ["السلام عليكم", "salam", "سلام", "slm", "hello", "hi"],
  },
];

function normalizeText(message: string): string {
  return message
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[؟?!.،,؛:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findMatchedIntent(
  normalizedText: string,
): Pick<FirstEntryIntentAnalysis, "intent" | "confidence" | "matchedPattern"> {
  if (!normalizedText) {
    return {
      intent: "unknown",
      confidence: "low",
    };
  }

  for (const group of intentPatterns) {
    const matchedPattern = group.patterns.find((pattern) =>
      normalizedText.includes(normalizeText(pattern)),
    );

    if (matchedPattern) {
      return {
        intent: group.intent,
        confidence: group.confidence,
        matchedPattern,
      };
    }
  }

  return {
    intent: "unknown",
    confidence: "low",
  };
}

function extractEntities(
  normalizedText: string,
): FirstEntryIntentAnalysis["extractedEntities"] | undefined {
  const entities: NonNullable<FirstEntryIntentAnalysis["extractedEntities"]> = {};
  const sizeMatch = normalizedText.match(/\b(3[0-9]|4[0-9])\b/);

  if (sizeMatch) {
    entities.size = sizeMatch[1];
  }

  if (
    /\b(wa7da|wahda|one)\b/.test(normalizedText) ||
    normalizedText.includes("وحدة") ||
    normalizedText.includes("واحد")
  ) {
    entities.quantity = 1;
  }

  if (
    /\b(jouj|two)\b/.test(normalizedText) ||
    normalizedText.includes("جوج")
  ) {
    entities.quantity = 2;
  }

  if (normalizedText.includes("كازا") || normalizedText.includes("casa")) {
    entities.city = normalizedText.includes("casa") ? "casa" : "كازا";
  }

  const colorMap: Array<[string, string]> = [
    ["اسود", "أسود"],
    ["كحل", "أسود"],
    ["black", "أسود"],
    ["وردي", "وردي"],
    ["rose", "وردي"],
    ["pink", "وردي"],
    ["ابيض", "أبيض"],
    ["white", "أبيض"],
  ];
  const matchedColor = colorMap.find(([keyword]) =>
    normalizedText.includes(keyword),
  );

  if (matchedColor) {
    entities.color = matchedColor[1];
  }

  return Object.keys(entities).length ? entities : undefined;
}

export function analyzeFirstEntryLeadIntent(
  message: string,
): FirstEntryIntentAnalysis {
  const normalizedText = normalizeText(message);
  const matched = findMatchedIntent(normalizedText);
  const extractedEntities = extractEntities(normalizedText);

  return {
    intent: matched.intent,
    confidence: matched.confidence,
    normalizedText,
    matchedPattern: matched.matchedPattern,
    extractedEntities,
    previewOnly: true,
  };
}

function uniqueWarnings(warnings: Array<string | undefined>): string[] {
  return Array.from(new Set(warnings.filter(Boolean) as string[]));
}

function appendCtaLine(lines: string[], renderResult: FirstEntryRenderResult): void {
  const ctaLine = renderFirstEntryCtaLine(
    renderResult.ctaMode,
    renderResult.policy.greetingStyle,
  );

  if (ctaLine) {
    lines.push("");
    lines.push(ctaLine);
  }
}

function getPaymentLine(
  sellerConfig: SellerConfig,
  renderResult: FirstEntryRenderResult,
): string | undefined {
  return renderFirstEntryPaymentLine(sellerConfig, renderResult.policy);
}

function buildAvailabilityPreview(productContext: ProductContext): string {
  if (productContext.stock?.status === "OUT_OF_STOCK") {
    return "المنتج غير متوفر حالياً.";
  }

  if (
    productContext.stock?.status === "AVAILABLE" ||
    productContext.stock?.status === "LIMITED"
  ) {
    return "نعم، المنتج متوفر حالياً.";
  }

  return "المنتج ظاهر كمتوفر في الإعدادات الحالية.";
}

function buildIntentText(input: {
  sellerConfig: SellerConfig;
  productContext: ProductContext;
  renderResult: FirstEntryRenderResult;
  intent: FirstEntryLeadIntent;
  warnings: string[];
}): { text: string; recommendedNextStep: FirstEntryRecommendedNextStep } {
  const lines: string[] = [];

  if (input.intent === "price") {
    const price = formatFirstEntryPrice(input.productContext);
    lines.push("سلام 👋");

    if (price && input.renderResult.policy.showPrice) {
      lines.push(`الثمن هو ${price}.`);
    } else {
      lines.push("نقدر نعاونك بالمعلومات المتوفرة على المنتج.");
      input.warnings.push("price_unavailable");
    }

    if (input.renderResult.policy.showDelivery) {
      const deliveryLine = renderFirstEntryDeliveryLine(
        input.renderResult.deliveryPolicy,
        input.warnings,
      );

      if (deliveryLine) {
        lines.push(deliveryLine);
      }
    }

    const paymentLine = getPaymentLine(input.sellerConfig, input.renderResult);

    if (paymentLine) {
      lines.push(paymentLine);
    }

    appendCtaLine(lines, input.renderResult);

    return {
      text: lines.join("\n").trim(),
      recommendedNextStep: "answer_price_then_cta_preview",
    };
  }

  if (input.intent === "order") {
    return {
      text: [
        "مرحبا 👋",
        "واضح أنك بغيتي دير الطلب.",
        "في الربط الحي، غادي نبدأو نجمعو اختيارات الطلب حسب الإعدادات.",
      ].join("\n"),
      recommendedNextStep: "handoff_order_path_preview",
    };
  }

  if (input.intent === "info") {
    return {
      text: "أكيد 👌\nنقدر نعرض لك معلومات أكثر على المنتج.",
      recommendedNextStep: "handoff_info_path_preview",
    };
  }

  if (input.intent === "media") {
    return {
      text: "أكيد، نقدر نعرض لك الصور المتوفرة للمنتج.",
      recommendedNextStep: "handoff_media_info_preview",
    };
  }

  if (input.intent === "availability") {
    lines.push(buildAvailabilityPreview(input.productContext));
    appendCtaLine(lines, input.renderResult);

    return {
      text: lines.join("\n").trim(),
      recommendedNextStep: "answer_availability_then_cta_preview",
    };
  }

  if (input.intent === "delivery") {
    const deliveryLine = input.renderResult.policy.showDelivery
      ? renderFirstEntryDeliveryLine(
          input.renderResult.deliveryPolicy,
          input.warnings,
        )
      : undefined;

    lines.push(deliveryLine || "معلومات التوصيل غير متاحة حالياً فالإعدادات.");

    if (!deliveryLine) {
      input.warnings.push("delivery_unavailable");
    }

    appendCtaLine(lines, input.renderResult);

    return {
      text: lines.join("\n").trim(),
      recommendedNextStep: "answer_delivery_then_cta_preview",
    };
  }

  if (input.intent === "payment") {
    const paymentLine = getPaymentLine(input.sellerConfig, input.renderResult);

    lines.push(paymentLine || "معلومات الدفع غير متاحة حالياً فالإعدادات.");

    if (!paymentLine) {
      input.warnings.push("payment_unavailable");
    }

    appendCtaLine(lines, input.renderResult);

    return {
      text: lines.join("\n").trim(),
      recommendedNextStep: "answer_payment_then_cta_preview",
    };
  }

  return {
    text: input.renderResult.text,
    recommendedNextStep: "show_first_entry",
  };
}

export function renderIntentAwareFirstEntryPreview(
  input: IntentAwareFirstEntryPreviewInput,
): IntentAwareFirstEntryPreviewResult {
  const sellerConfig = normalizeSellerConfig(
    input.sellerConfig,
    input.productContext.price,
  );
  const intent = analyzeFirstEntryLeadIntent(input.customerMessage);
  const renderResult = renderFirstEntryMessage({
    sellerConfig,
    productContext: input.productContext,
  });
  const eligibility = evaluateFirstEntryEligibility({
    sellerConfig,
    productContext: input.productContext,
    session: input.session,
    orderState: input.orderState,
  });
  const warnings = [...(renderResult.warnings || [])];

  if (!eligibility.eligible) {
    return {
      previewOnly: true,
      intent,
      eligibility,
      renderResult,
      recommendedNextStep: "do_not_show_first_entry",
      text: "",
      ctas: renderResult.ctas,
      uiHints: renderResult.uiHints,
      warnings: uniqueWarnings([...warnings, ...(eligibility.warnings || [])]),
    };
  }

  const textResult = buildIntentText({
    sellerConfig,
    productContext: input.productContext,
    renderResult,
    intent: intent.intent,
    warnings,
  });

  return {
    previewOnly: true,
    intent,
    eligibility,
    renderResult,
    recommendedNextStep: textResult.recommendedNextStep,
    text: textResult.text,
    ctas: renderResult.ctas,
    uiHints: renderResult.uiHints,
    warnings: uniqueWarnings(warnings),
  };
}
