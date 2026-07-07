import type { AIIntentRouterAnalysis } from "../ai/ai-intent-router.service";
import { DEFAULT_PRODUCT_CONTEXT } from "../default-product-context";
import { getColorFromMessage } from "../direct-answer/intent-detectors";
import { includesAny, normalizeText } from "../direct-answer/text-normalization";
import { buildSalesResponse, OLD_GENERIC_FALLBACK_REPLY } from "../sales/sales-response.builder";
import type { ProductContext } from "../product-context.types";
import {
  buildSellerBrainResponse,
  canSellerBrainHandle,
} from "./seller-brain-response.service";
import type { SellerBrainEvalCase, SellerBrainEvalResult } from "./seller-brain.types";

export interface SellerBrainEvalReport {
  summary: {
    total: number;
    genericFallbackCount: number;
    repeatedReplyCount: number;
    unsafeClaimCount: number;
    avgDurationMs: number;
    maxDurationMs: number;
    passed: boolean;
  };
  results: SellerBrainEvalResult[];
}

const defaultSellerBrainEvalCases: SellerBrainEvalCase[] = [
  { message: "شحال الثمن؟" },
  { message: "bch7al hadi" },
  { message: "prix?" },
  { message: "آخر ثمن" },
  { message: "wach taman akhor" },
  { message: "غالية عليا" },
  { message: "صراحة غالية عليا" },
  { message: "لقيتها ناقصة فبلاصة أخرى" },
  { message: "ana l9it b7alha rkhssa" },
  { message: "واش ماشي نصابة" },
  { message: "كيفاش نضمن توصلي السلعة؟" },
  { message: "kifach n3rfkom mashi nasaba" },
  { message: "واش نقدر نثق فيكم" },
  { message: "شنو الألوان لي كاينين؟" },
  { message: "Ina alwan kaynin" },
  { message: "chno alwan" },
  { message: "كاين الأسود؟" },
  { message: "kayn black?" },
  { message: "كاين الأبيض؟" },
  { message: "Brayt lon sfar" },
  { message: "بغيت لون صفر" },
  { message: "كاين مقاس 38؟" },
  { message: "واش كاين مقاس 39؟" },
  { message: "كاين مقاس 41؟" },
  { message: "شنو المقاسات؟" },
  { message: "شنو كتبيعو" },
  { message: "شنو هو المنتوج لي عندكم" },
  { message: "xno katbi3o" },
  { message: "what do you sell" },
  { message: "راني محتارة شنو ناخد" },
  { message: "شنو كتنصحني ناخد؟" },
  { message: "شنو اللون لي خارج أكثر" },
  { message: "ach men color zwina" },
  { message: "واش كتجي مريحة" },
  { message: "katji mri7a?" },
  { message: "عندي رجل شوية عريضة شنو ناخد؟" },
  { message: "بغيتها للخروج واش زوينة" },
  { message: "واش مناسبة للخروج؟" },
  { message: "فين نقدر نشوفها" },
  { message: "فين المحل؟" },
  { message: "adresse magasin?" },
  { message: "شنو سميتك" },
  { message: "واش إنسان" },
  { message: "nta bot?" },
  { message: "merci" },
  { message: "ok" },
  { message: "hmm" },
  { message: "سلام" },
  { message: "hello" },
  { message: "صيفط ليا الصور" },
  { message: "send me pictures" },
  { message: "واش كاين التوصيل والدفع حتى توصلني؟" },
  { message: "التوصيل شحال" },
  { message: "كاين الدفع عند الاستلام؟" },
  { message: "bghit wahda 38 casa" },
  { message: "بغيت نكوموندي" },
  { message: "عافاك بغيت وحدة مقاس 37 للدار البيضاء" },
  { message: "شنو رأيك فالماتش؟" },
  { message: "واش كتبيعو صباط رجالي؟" },
  { message: "عندكم صباط رجالي؟" },
  { message: "ما فهمتش" },
  { message: "???" },
  { message: "labas" },
  { message: "صراحة غالية عليا", customerId: "repeat-price-objection" },
  { message: "صراحة غالية عليا", customerId: "repeat-price-objection" },
  { message: "صراحة غالية عليا", customerId: "repeat-price-objection" },
  { message: "راني محتارة شنو ناخد", customerId: "repeat-recommendation" },
  { message: "راني محتارة شنو ناخد", customerId: "repeat-recommendation" },
  { message: "راني محتارة شنو ناخد", customerId: "repeat-recommendation" },
];

function hasUnsafeClaim(reply: string): boolean {
  if (
    includesAny(reply, [
      "ما نقدرش نأكد تخفيض",
      "ما عنديش تخفيض",
      "بلا إحصائية",
      "ما عنديش إحصائية",
    ])
  ) {
    return false;
  }

  return [
    "توصيل مجاني",
    "livraison gratuite",
    "free delivery",
    "الأكثر مبيعا",
    "الأكثر مبيعاً",
    "best seller",
    "تخفيض",
    "خصم",
    "آراء الزبناء كاينة",
    "reviews available",
  ].some((term) => reply.toLowerCase().includes(term.toLowerCase()));
}

function detectSize(message: string): string | null {
  return message.match(/\b(3[6-9]|4[0-5])\b/)?.[1] || null;
}

function baseAnalysis(message: string): AIIntentRouterAnalysis {
  return {
    intent: "unknown",
    subIntent: null,
    entities: {
      size: null,
      color: null,
      city: null,
      quantity: null,
      phone: null,
      fullName: null,
      address: null,
    },
    language: /[a-z]/i.test(message)
      ? /[\u0600-\u06ff]/.test(message)
        ? "mixed"
        : "arabizi"
      : /[\u0600-\u06ff]/.test(message)
        ? "darija"
        : "unknown",
    customerMood: "neutral",
    salesStage: "asking_info",
    salesOpportunity: true,
    shouldUseDirectAnswer: false,
    shouldContinueOrderFlow: false,
    confidence: 0.9,
  };
}

function inferEvalAnalysis(message: string): AIIntentRouterAnalysis {
  const analysis = baseAnalysis(message);
  const normalizedMessage = normalizeText(message);
  const color = getColorFromMessage(message);
  const size = detectSize(message);

  if (color) {
    analysis.entities.color = color.replyName.replace(/^ال/, "");
  }

  if (size) {
    analysis.entities.size = size;
  }

  if (includesAny(message, ["صيفط", "صور", "تصاور", "pictures", "photos"])) {
    return { ...analysis, intent: "image_request", subIntent: "request_product_images" };
  }

  if (includesAny(message, ["توصيل", "delivery", "livraison"])) {
    return { ...analysis, intent: "delivery_question", subIntent: "delivery_info" };
  }

  if (includesAny(message, ["الدفع", "عند الاستلام", "pay", "paiement"])) {
    return { ...analysis, intent: "payment_question", subIntent: "cash_on_delivery" };
  }

  if (
    color &&
    includesAny(message, [
      "لون",
      "اللون",
      "lon",
      "color",
      "couleur",
      "brayt lon",
      "bghit yellow",
      "bghit jaune",
    ])
  ) {
    return {
      ...analysis,
      intent: "color_question",
      subIntent: "specific_color",
      customerMood: "interested",
    };
  }

  if (
    includesAny(message, [
      "رجل شوية عريضة",
      "رجل عريضة",
      "wide foot",
    ])
  ) {
    return {
      ...analysis,
      intent: "product_info_question",
      subIntent: "size_recommendation",
      customerMood: "interested",
    };
  }

  if (
    includesAny(message, [
      "للخروج",
      "الخروج",
      "مناسبة",
      "l khroj",
      "lkhroj",
      "khroj",
    ])
  ) {
    return {
      ...analysis,
      intent: "product_info_question",
      subIntent: "usage_question",
      customerMood: "interested",
    };
  }

  if (
    includesAny(message, ["بغيت", "ncommand", "نطلب", "نكوموندي"]) &&
    (size || includesAny(message, ["واحدة", "وحدة", "جوج", "wa7da", "wahda", "jouj"]))
  ) {
    return {
      ...analysis,
      intent: "order_start",
      subIntent: "provide_order_info",
      customerMood: "ready_to_order",
      salesStage: "ready_to_order",
      shouldContinueOrderFlow: true,
    };
  }

  if (
    includesAny(message, [
      "نصابة",
      "نصاب",
      "نضمن",
      "نثق",
      "ثقة",
      "nasaba",
      "scam",
    ])
  ) {
    return {
      ...analysis,
      intent: "objection_trust",
      subIntent: "trust_concern",
      customerMood: "hesitant",
      salesStage: "comparing",
    };
  }

  if (
    includesAny(message, [
      "غالي",
      "غالية",
      "ناقصة",
      "رخيصة",
      "ثمن اخر",
      "تمن اخر",
      "آخر ثمن",
      "taman akhor",
      "rkhssa",
      "rkhis",
      "ghali",
    ])
  ) {
    return {
      ...analysis,
      intent: includesAny(message, ["آخر ثمن", "taman akhor", "ثمن اخر", "ناقصة", "rkhssa"])
        ? "negotiation"
        : "objection_price",
      subIntent: includesAny(message, ["آخر ثمن", "taman akhor", "ثمن اخر"])
        ? "price_negotiation"
        : "price_comparison",
      customerMood: "price_sensitive",
      salesStage: "comparing",
    };
  }

  if (
    includesAny(message, [
      "محتارة",
      "تنصحني",
      "شنو ناخد",
      "اللون لي خارج",
      "popular",
      "ach men color",
    ])
  ) {
    return {
      ...analysis,
      intent: "product_info_question",
      subIntent: includesAny(message, ["خارج", "popular"])
        ? "popular_color"
        : "recommendation_request",
      customerMood: "interested",
    };
  }

  if (includesAny(message, ["مريحة", "mri7a", "comfortable"])) {
    return {
      ...analysis,
      intent: "product_info_question",
      subIntent: "comfort_question",
      customerMood: "interested",
    };
  }

  if (includesAny(message, ["للخروج", "مناسبة", "usage", "use"])) {
    return {
      ...analysis,
      intent: "product_info_question",
      subIntent: "usage_question",
      customerMood: "interested",
    };
  }

  if (includesAny(message, ["فين", "المحل", "adresse", "magasin", "store"])) {
    return {
      ...analysis,
      intent: "product_info_question",
      subIntent: "store_location",
      customerMood: "interested",
    };
  }

  if (includesAny(message, ["سميتك", "واش انسان", "واش إنسان", "bot", "who are you"])) {
    return {
      ...analysis,
      intent: "product_info_question",
      subIntent: includesAny(message, ["انسان", "إنسان", "bot"]) ? "human_check" : "assistant_identity",
    };
  }

  if (includesAny(message, ["شنو كتبيع", "شنو هو المنتوج", "xno katbi3o", "what do you sell"])) {
    return {
      ...analysis,
      intent: "product_info_question",
      subIntent: "product_overview",
      customerMood: "interested",
    };
  }

  if (includesAny(message, ["لون", "ألوان", "الوان", "color", "alwan"]) || color) {
    return {
      ...analysis,
      intent: "color_question",
      subIntent: color ? "specific_color" : "available_colors",
    };
  }

  if (includesAny(message, ["مقاس", "قياس", "size", "taille"]) || size) {
    return {
      ...analysis,
      intent: "size_question",
      subIntent: size ? "specific_size" : "available_sizes",
    };
  }

  if (includesAny(message, ["ثمن", "تمن", "شحال", "price", "prix", "bch7al"])) {
    return { ...analysis, intent: "price_question", subIntent: "product_price" };
  }

  if (["merci", "ok", "hmm", "سلام", "hello", "labas"].includes(normalizedMessage)) {
    return {
      ...analysis,
      intent: normalizedMessage === "سلام" || normalizedMessage === "hello" ? "greeting" : "unknown",
      subIntent: "acknowledgement",
    };
  }

  return analysis;
}

export async function evaluateSellerBrain(input?: {
  cases?: SellerBrainEvalCase[];
  productContext?: ProductContext;
}): Promise<SellerBrainEvalReport> {
  const testCases = input?.cases?.length ? input.cases : defaultSellerBrainEvalCases;
  const productContext = input?.productContext || DEFAULT_PRODUCT_CONTEXT;
  const results: SellerBrainEvalResult[] = [];
  const recentReplyKeysByCustomer = new Map<string, string[]>();
  const repliesByCustomer = new Map<string, Set<string>>();

  for (const [index, testCase] of testCases.entries()) {
    const startedAt = Date.now();
    const intentAnalysis = inferEvalAnalysis(testCase.message);
    const customerId = testCase.customerId || `seller-brain-eval-${index}`;
    const recentReplyKeys = recentReplyKeysByCustomer.get(customerId) || [];
    const response = canSellerBrainHandle(intentAnalysis)
      ? buildSellerBrainResponse({
          message: testCase.message,
          productContext,
          intentAnalysis,
          customerId,
          recentReplyKeys,
        })
      : (() => {
          const salesResponse = buildSalesResponse({
            message: testCase.message,
            productContext,
            analysis: intentAnalysis,
            customerId,
          });

          return {
            reply: salesResponse.reply,
            replyKey: `sales_${intentAnalysis.intent}_${intentAnalysis.subIntent || "none"}`,
            source: "seller_brain" as const,
          };
        })();
    const durationMs = Date.now() - startedAt;
    const previousReplies = repliesByCustomer.get(customerId) || new Set<string>();
    const repeatedReply = previousReplies.has(response.reply);
    previousReplies.add(response.reply);
    repliesByCustomer.set(customerId, previousReplies);
    recentReplyKeysByCustomer.set(
      customerId,
      [...recentReplyKeys.filter((replyKey) => replyKey !== response.replyKey), response.replyKey].slice(-5),
    );

    results.push({
      message: testCase.message,
      intent: intentAnalysis.intent,
      reply: response.reply,
      replyKey: response.replyKey,
      source: "seller_brain",
      durationMs,
      genericFallback: response.reply === OLD_GENERIC_FALLBACK_REPLY,
      repeatedReply,
      unsafeClaim: hasUnsafeClaim(response.reply),
    });
  }
  const finalResults = results;
  const total = finalResults.length;
  const genericFallbackCount = finalResults.filter(
    (result) => result.genericFallback,
  ).length;
  const repeatedReplyCount = finalResults.filter(
    (result) => result.repeatedReply,
  ).length;
  const unsafeClaimCount = finalResults.filter((result) => result.unsafeClaim).length;
  const maxDurationMs = finalResults.length
    ? Math.max(...finalResults.map((result) => result.durationMs))
    : 0;
  const avgDurationMs = total
    ? Number(
        (
          finalResults.reduce((sum, result) => sum + result.durationMs, 0) / total
        ).toFixed(1),
      )
    : 0;

  return {
    summary: {
      total,
      genericFallbackCount,
      repeatedReplyCount,
      unsafeClaimCount,
      avgDurationMs,
      maxDurationMs,
      passed:
        genericFallbackCount === 0 &&
        repeatedReplyCount <= 6 &&
        unsafeClaimCount === 0 &&
        maxDurationMs <= 100,
    },
    results: finalResults,
  };
}
