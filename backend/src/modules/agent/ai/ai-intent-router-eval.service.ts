import {
  analyzeAIIntentWithMeta,
  type AIIntentRouterIntent,
} from "./ai-intent-router.service";
import type { ProductContext } from "../product-context.types";

export type IntentEvalCase = {
  message: string;
  expectedIntent: AIIntentRouterIntent;
  expectedUsedAI?: boolean;
  expectedEntities?: Partial<{
    size: string | null;
    color: string | null;
    city: string | null;
    quantity: number | null;
    phone: string | null;
    fullName: string | null;
    address: string | null;
  }>;
};

export type IntentEvalResult = {
  message: string;
  expectedIntent: AIIntentRouterIntent;
  actualIntent: AIIntentRouterIntent;
  passedIntent: boolean;
  passedEntities: boolean;
  passedUsedAI: boolean;
  durationMs: number;
  usedAI: boolean;
  timedOut: boolean;
  validationFailed: boolean;
  expectedEntities?: IntentEvalCase["expectedEntities"];
  expectedUsedAI?: boolean;
  actualEntities: IntentEvalCase["expectedEntities"];
};

export type IntentEvalSummary = {
  total: number;
  passedIntent: number;
  failedIntent: number;
  avgDurationMs: number;
  slowCount: number;
  aiUsedCount: number;
  validationFailedCount: number;
  failedUsedAI: number;
};

export type IntentEvalReport = {
  summary: IntentEvalSummary;
  results: IntentEvalResult[];
};

const SLOW_THRESHOLD_MS = 500;

const defaultIntentEvalCases: IntentEvalCase[] = [
  {
    message: "first_entry:more_info",
    expectedIntent: "product_info_question",
    expectedUsedAI: false,
  },
  {
    message: "info:sizes",
    expectedIntent: "size_question",
    expectedUsedAI: false,
  },
  {
    message: "info:colors",
    expectedIntent: "color_question",
    expectedUsedAI: false,
  },
  {
    message: "info:continue_order",
    expectedIntent: "order_start",
    expectedUsedAI: false,
  },
  {
    message: "info:more_info",
    expectedIntent: "product_info_question",
    expectedUsedAI: false,
  },
  {
    message: "size:37",
    expectedIntent: "order_followup",
    expectedUsedAI: false,
    expectedEntities: { size: "37" },
  },
  {
    message: "color:أسود",
    expectedIntent: "order_followup",
    expectedUsedAI: false,
  },
  {
    message: "field:skip:note",
    expectedIntent: "order_followup",
    expectedUsedAI: false,
  },
  {
    message: "order:confirm",
    expectedIntent: "order_confirmation",
    expectedUsedAI: false,
  },
  {
    message: "order:edit",
    expectedIntent: "order_correction",
    expectedUsedAI: false,
  },
  {
    message: "salam bghit ncommande wa7da 38 f casa",
    expectedIntent: "order_start",
    expectedEntities: { size: "38", quantity: 1 },
  },
  {
    message: "nakhod 2 pointure 39 l casa",
    expectedIntent: "order_start",
    expectedEntities: { size: "39", city: "casa", quantity: 2 },
  },
  {
    message: "بغيت نطلب 2 مقاس 40 للدار البيضاء",
    expectedIntent: "order_start",
    expectedEntities: { size: "40", quantity: 2 },
  },
  {
    message: "khoud lia 41 f fes jouj",
    expectedIntent: "order_start",
    expectedEntities: { size: "41", city: "fes", quantity: 2 },
  },
  {
    message: "سميتي سارة 0612345678 حي النصر",
    expectedIntent: "order_followup",
    expectedEntities: { fullName: "سارة", phone: "0612345678" },
  },
  {
    message: "المدينة طنجة",
    expectedIntent: "order_followup",
    expectedEntities: { city: "طنجة" },
  },
  {
    message: "العنوان حي القدس رقم 12",
    expectedIntent: "order_followup",
    expectedEntities: { address: "حي القدس رقم 12" },
  },
  {
    message: "quantity 2",
    expectedIntent: "order_followup",
    expectedEntities: { quantity: 2 },
  },
  {
    message: "غلط المدينة هي الرباط",
    expectedIntent: "order_correction",
    expectedEntities: { city: "الرباط" },
  },
  {
    message: "بدل الهاتف 0611111111",
    expectedIntent: "order_correction",
    expectedEntities: { phone: "0611111111" },
  },
  {
    message: "خلي اللون أسود",
    expectedIntent: "order_correction",
    expectedEntities: { color: "أسود" },
  },
  {
    message: "bch7al hadi",
    expectedIntent: "price_question",
    expectedUsedAI: false,
  },
  {
    message: "Bach7l hadi",
    expectedIntent: "price_question",
    expectedUsedAI: false,
  },
  {
    message: "bach7l hadi",
    expectedIntent: "price_question",
    expectedUsedAI: false,
  },
  {
    message: "bch7l hadi",
    expectedIntent: "price_question",
    expectedUsedAI: false,
  },
  {
    message: "اك تقد تصوب لي كومند ديالي",
    expectedIntent: "order_start",
    expectedUsedAI: false,
  },
  {
    message: "الطلب",
    expectedIntent: "order_start",
    expectedUsedAI: false,
  },
  {
    message: "commande",
    expectedIntent: "order_start",
    expectedUsedAI: false,
  },
  {
    message: "شنو الثمن ديالها؟",
    expectedIntent: "price_question",
  },
  {
    message: "واش كاين مقاس 39؟",
    expectedIntent: "size_question",
    expectedEntities: { size: "39" },
  },
  {
    message: "كاين مقاس 38؟",
    expectedIntent: "size_question",
    expectedEntities: { size: "38" },
  },
  {
    message: "pointures?",
    expectedIntent: "size_question",
    expectedUsedAI: false,
  },
  {
    message: "Ina alwan kaynin",
    expectedIntent: "color_question",
  },
  {
    message: "kayn white?",
    expectedIntent: "color_question",
    expectedEntities: { color: "أبيض" },
  },
  {
    message: "Brayt lon sfar",
    expectedIntent: "color_question",
    expectedEntities: { color: "أصفر" },
  },
  {
    message: "واش كاين التوصيل والدفع حتى توصلني؟",
    expectedIntent: "payment_question",
  },
  {
    message: "التوصيل شحال",
    expectedIntent: "delivery_question",
  },
  {
    message: "واش التوصيل مجاني؟",
    expectedIntent: "delivery_question",
  },
  {
    message: "كاين الدفع عند الاستلام؟",
    expectedIntent: "payment_question",
  },
  {
    message: "send me pictures",
    expectedIntent: "image_request",
  },
  {
    message: "sift lia tsawr",
    expectedIntent: "image_request",
  },
  {
    message: "wach taman akhor? ghali chwiya",
    expectedIntent: "negotiation",
  },
  {
    message: "غالي شوية",
    expectedIntent: "objection_price",
  },
  {
    message: "لقيتها ناقصة فبلاصة أخرى",
    expectedIntent: "negotiation",
  },
  {
    message: "كيفاش نضمن توصلي السلعة؟",
    expectedIntent: "objection_trust",
  },
  {
    message: "واش عندكم شي آراء ديال الزبناء؟",
    expectedIntent: "objection_trust",
  },
  {
    message: "شنو كتنصحني ناخد؟",
    expectedIntent: "product_info_question",
  },
  {
    message: "واش مناسبة للخروج؟",
    expectedIntent: "product_info_question",
  },
  {
    message: "شنو هو المنتوج لي عندكم",
    expectedIntent: "product_info_question",
  },
  {
    message: "شنو سميتك",
    expectedIntent: "product_info_question",
  },
  {
    message: "واش إنسان",
    expectedIntent: "product_info_question",
  },
  {
    message: "hello",
    expectedIntent: "greeting",
  },
  {
    message: "سلام",
    expectedIntent: "greeting",
  },
  {
    message: "merci",
    expectedIntent: "greeting",
  },
  {
    message: "hmm",
    expectedIntent: "unknown",
  },
  {
    message: "ok",
    expectedIntent: "unknown",
  },
  {
    message: "شنو رأيك فالماتش؟",
    expectedIntent: "unknown",
  },
];

function compareExpectedEntities(
  actualEntities: IntentEvalResult["actualEntities"],
  expectedEntities?: IntentEvalCase["expectedEntities"],
): boolean {
  if (!expectedEntities || !Object.keys(expectedEntities).length) {
    return true;
  }

  return Object.entries(expectedEntities).every(
    ([key, expectedValue]) =>
      actualEntities?.[key as keyof typeof actualEntities] === expectedValue,
  );
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function evaluateIntentRouter(input?: {
  cases?: IntentEvalCase[];
  productContext?: ProductContext;
}): Promise<IntentEvalReport> {
  const cases = input?.cases?.length ? input.cases : defaultIntentEvalCases;
  const results: IntentEvalResult[] = [];

  for (const testCase of cases) {
    const result = await analyzeAIIntentWithMeta({
      message: testCase.message,
      productContext: input?.productContext,
    });
    const actualEntities = result.intentAnalysis.entities;
    const passedIntent =
      result.intentAnalysis.intent === testCase.expectedIntent;
    const passedEntities = compareExpectedEntities(
      actualEntities,
      testCase.expectedEntities,
    );
    const passedUsedAI =
      typeof testCase.expectedUsedAI === "boolean"
        ? result.meta.usedAI === testCase.expectedUsedAI
        : true;

    results.push({
      message: testCase.message,
      expectedIntent: testCase.expectedIntent,
      actualIntent: result.intentAnalysis.intent,
      passedIntent,
      passedEntities,
      passedUsedAI,
      durationMs: result.meta.durationMs,
      usedAI: result.meta.usedAI,
      timedOut: result.meta.timedOut,
      validationFailed: result.meta.validationFailed,
      expectedEntities: testCase.expectedEntities,
      expectedUsedAI: testCase.expectedUsedAI,
      actualEntities,
    });
  }

  const totalDuration = results.reduce(
    (sum, result) => sum + result.durationMs,
    0,
  );

  return {
    summary: {
      total: results.length,
      passedIntent: results.filter((result) => result.passedIntent).length,
      failedIntent: results.filter((result) => !result.passedIntent).length,
      avgDurationMs: results.length
        ? roundOneDecimal(totalDuration / results.length)
        : 0,
      slowCount: results.filter(
        (result) => result.durationMs > SLOW_THRESHOLD_MS,
      ).length,
      aiUsedCount: results.filter((result) => result.usedAI).length,
      validationFailedCount: results.filter(
        (result) => result.validationFailed,
      ).length,
      failedUsedAI: results.filter((result) => !result.passedUsedAI).length,
    },
    results,
  };
}
