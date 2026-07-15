import { z } from "zod";
import { env } from "../../../config/env";
import { generateStructuredAIReply } from "../../ai/ai.service";
import type { ProductContext } from "../product-context.types";
import type {
  InformationalAIAnswerDependencies,
  InformationalAIAnswerInput,
  InformationalAIAnswerResult,
} from "./informational-ai-answer.types";

export const INFORMATIONAL_AI_SAFE_FALLBACK =
  "ما قدرتش نأكد هاد المعلومة دابا، ولكن نقدر نعاونك نكمل الطلب.";

const answerOnlySchema = z
  .object({
    answer: z.string().trim().min(1).max(360),
    grounded: z.boolean(),
    cannotAnswer: z.boolean().optional(),
  })
  .strict();

const answerOnlyJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "grounded"],
  properties: {
    answer: { type: "string", minLength: 1, maxLength: 360 },
    grounded: { type: "boolean" },
    cannotAnswer: { type: "boolean" },
  },
};

const internalActionPattern = /^(?:first_entry:|info:|size:|color:|field:|order:|edit:|confirm:)/i;
const phonePattern = /(?:\+212|0)[67]\d{8}\b/;
const priceClaimPattern = /(?:\b\d+(?:[.,]\d+)?\s*(?:درهم|mad|dhs?|ريال|€|\$)\b|الثمن\s+(?:هو|ديالو)?\s*\d+)/iu;
const lifecycleClaimPattern = /(?:نأكد\s+(?:لك\s+)?الطلب|أكدت\s+(?:لك\s+)?الطلب|تم\s+تأكيد\s+الطلب|سجلت\s+(?:لك\s+)?الطلب|أنشأت\s+(?:لك\s+)?الطلب|رقم\s+الطلب|المجموع\s*[:：]|order:|field:|confirm:)/iu;
const directQuestionPattern = /(?:الثمن|السعر|التمن|شحال|بشحال|price|prix|taman|bch7al|bach7l|التوصيل|livraison|delivery|الدفع|paiement|payment|عند الاستلام|المقاس|المقاسات|size|sizes|pointure|اللون|الألوان|color|couleur|الصور|image|photo|متوفر|متوفرة|available|disponible)/iu;
const informationalSemanticPattern = /(?:الموديل|المنتج|المنتوج|السلعة|مريح|مريحة|الراحة|واقف|الخدمة|الاستعمال|استعمال|مناسب|مناسبة|الجودة|المادة|القماش|الجلد|الضمان|الصنع|للخروج|product|model|comfortable|comfort|quality|material|fabric|suitable|usage|use\s+it|work|debout|confort|matiere|matière|qualite|qualité)/iu;
const questionFormPattern = /[؟?]|^(?:واش|وش|هل|شنو|اش|آش|كيفاش|علاش|فين|wach|wash|chno|ach|est[ -]?ce|how|what|is|does|can)\b/iu;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maxLength = 240): string {
  const clean = value.trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

function compactList(values: string[] | undefined, limit = 8): string[] {
  return (values || [])
    .map((value) => truncate(value))
    .filter(Boolean)
    .slice(0, limit);
}

function buildAllowedFactPack(productContext: ProductContext): Record<string, unknown> {
  const attributes = Object.fromEntries(
    Object.entries(productContext.attributes || {})
      .filter(([, value]) => Boolean(value?.trim()))
      .slice(0, 12)
      .map(([key, value]) => [truncate(key, 80), truncate(value)]),
  );
  const faqs = (productContext.faqs || [])
    .filter((faq) => faq.question?.trim() && faq.answer?.trim())
    .slice(0, 8)
    .map((faq) => ({
      question: truncate(faq.question),
      answer: truncate(faq.answer),
    }));

  return {
    seller: truncate(productContext.businessName, 100),
    product: truncate(productContext.productName, 120),
    category: productContext.category ? truncate(productContext.category, 100) : undefined,
    description: productContext.description ? truncate(productContext.description, 400) : undefined,
    features: compactList(productContext.features),
    attributes,
    faqs,
    recommendationNotes: compactList(productContext.recommendationNotes),
    extraNotes: compactList(productContext.extraNotes),
    warranty: productContext.warrantyInfo ? truncate(productContext.warrantyInfo) : undefined,
    condition: productContext.condition ? truncate(productContext.condition) : undefined,
  };
}

function buildPrompt(message: string, factPack: Record<string, unknown>): string {
  return [
    "رجع JSON فقط حسب السكيمة المعطاة.",
    "جاوب كسولير مساعد بالدارجة المغربية، بجوج جمل كحد أقصى.",
    "استعمل غير الحقائق الموجودة فـ FACTS. إلا ما كافياش، grounded=false وcannotAnswer=true.",
    "ممنوع تخترع الثمن، التوصيل، الدفع، التخفيض، الألوان، المقاسات، العنوان، الهاتف، الآراء أو الجودة.",
    "ممنوع تجمع معلومات الطلب أو تبدلها أو تأكد الطلب أو تحسب الثمن أو تعطي أي action/id.",
    `QUESTION: ${JSON.stringify(message.trim())}`,
    `FACTS: ${JSON.stringify(factPack)}`,
  ].join("\n");
}

function extractFirstJsonObject(text: string): string | null {
  const startIndex = text.indexOf("{");

  if (startIndex < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }

  return null;
}

function hasFactOverlap(answer: string, factPack: Record<string, unknown>): boolean {
  const facts = normalizeText(JSON.stringify(factPack));
  const tokens = normalizeText(answer)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4);

  return tokens.some((token) => facts.includes(token));
}

function validateGroundedAnswer(
  answer: string,
  factPack: Record<string, unknown>,
): boolean {
  const sentenceCount = answer
    .split(/[.!؟]+/u)
    .map((part) => part.trim())
    .filter(Boolean).length;

  return (
    answer.length <= 360 &&
    sentenceCount <= 2 &&
    !phonePattern.test(answer) &&
    !priceClaimPattern.test(answer) &&
    !lifecycleClaimPattern.test(answer) &&
    hasFactOverlap(answer, factPack)
  );
}

export function isInformationalAIEligible(
  message: string,
  options: { directAnswerGrounded?: boolean } = {},
): boolean {
  const clean = message.trim();

  if (
    options.directAnswerGrounded === true ||
    !clean ||
    internalActionPattern.test(clean) ||
    phonePattern.test(clean) ||
    /^\d+(?:[.,]\d+)?$/.test(clean) ||
    directQuestionPattern.test(clean)
  ) {
    return false;
  }

  return (
    questionFormPattern.test(clean) &&
    (informationalSemanticPattern.test(clean) || options.directAnswerGrounded === false)
  );
}

export async function answerInformationalQuestion(
  input: InformationalAIAnswerInput,
  dependencies: InformationalAIAnswerDependencies = {},
): Promise<InformationalAIAnswerResult> {
  const startedAt = Date.now();
  const eligible = input.eligible ?? isInformationalAIEligible(input.message);
  const fallbackMeta = {
    eligible,
    usedAI: false,
    timedOut: false,
    validationFailed: false,
    cannotAnswer: true,
    durationMs: 0,
  };

  if (!eligible) {
    return {
      reply: INFORMATIONAL_AI_SAFE_FALLBACK,
      meta: { ...fallbackMeta, skippedReason: "not_eligible" },
    };
  }

  const enabled =
    dependencies.enabledOverride ?? env.informationalAiEnabled;

  if (!enabled) {
    return {
      reply: INFORMATIONAL_AI_SAFE_FALLBACK,
      meta: { ...fallbackMeta, skippedReason: "disabled" },
    };
  }

  const factPack = buildAllowedFactPack(input.productContext);
  const generate =
    dependencies.generateStructuredReply || generateStructuredAIReply;

  try {
    const raw = await generate(
      buildPrompt(input.message, factPack),
      answerOnlyJsonSchema,
      { timeoutMs: env.informationalAiTimeoutMs },
    );
    const json = extractFirstJsonObject(raw);
    const parsed = json ? answerOnlySchema.safeParse(JSON.parse(json)) : null;
    const validationFailed =
      !parsed?.success ||
      parsed.data.grounded !== true ||
      parsed.data.cannotAnswer === true ||
      !validateGroundedAnswer(parsed.data.answer, factPack);
    const cannotAnswer =
      validationFailed ||
      !parsed?.success ||
      parsed.data.cannotAnswer === true ||
      parsed.data.grounded !== true;
    const durationMs = Date.now() - startedAt;

    console.log(JSON.stringify({
      event: "agent.informational_ai.answer",
      usedAI: true,
      timedOut: false,
      validationFailed,
      cannotAnswer,
      durationMs,
    }));

    return {
      reply: validationFailed
        ? INFORMATIONAL_AI_SAFE_FALLBACK
        : parsed.data.answer.trim(),
      meta: {
        eligible: true,
        usedAI: true,
        timedOut: false,
        validationFailed,
        cannotAnswer,
        durationMs,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const timedOut = /timed out|timeout|abort/i.test(errorMessage);

    console.warn(JSON.stringify({
      event: "agent.informational_ai.failed",
      timedOut,
      durationMs,
      errorMessage,
    }));

    return {
      reply: INFORMATIONAL_AI_SAFE_FALLBACK,
      meta: {
        eligible: true,
        usedAI: true,
        timedOut,
        validationFailed: !timedOut,
        cannotAnswer: true,
        durationMs,
      },
    };
  }
}
