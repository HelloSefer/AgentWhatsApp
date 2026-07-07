import { DEFAULT_PRODUCT_CONTEXT } from "../default-product-context";
import { generateAgentResult } from "../agent.service";
import { analyzeAIIntentWithMeta } from "../ai/ai-intent-router.service";
import { OLD_GENERIC_FALLBACK_REPLY } from "./sales-response.builder";
import type { ProductContext } from "../product-context.types";

export interface SalesReplyEvalCase {
  message: string;
  customerId?: string;
  expectedQuantity?: number;
}

export interface SalesReplyEvalResult {
  message: string;
  reply: string;
  source: string;
  durationMs: number;
  length: number;
  genericFallback: boolean;
  repeatedReply: boolean;
  detectedQuantity?: number | null;
  missingExpectedQuantity?: boolean;
}

export interface SalesReplyEvalReport {
  summary: {
    total: number;
    genericFallbackCount: number;
    repeatedReplyCount: number;
    missingQuantityCount: number;
    avgLength: number;
    passed: boolean;
  };
  results: SalesReplyEvalResult[];
}

const defaultSalesReplyEvalCases: SalesReplyEvalCase[] = [
  { message: "bch7al hadi" },
  { message: "Ina alwan kaynin" },
  { message: "Brayt lon sfar" },
  { message: "bghit wahda 38 casa", expectedQuantity: 1 },
  { message: "شنو هو المنتوج لي عندكم" },
  { message: "شنو كتبيعو" },
  { message: "شنو اللون لي خارج أكثر" },
  { message: "راني محتارة شنو ناخد" },
  { message: "واش كتجي مريحة" },
  { message: "بغيتها للخروج واش زوينة" },
  { message: "لقيتها ناقصة فبلاصة أخرى" },
  { message: "كيفاش نضمن توصلي السلعة؟" },
  { message: "واش ماشي نصابة" },
  { message: "آخر ثمن" },
  { message: "فين نقدر نشوفها" },
  { message: "شنو سميتك" },
  { message: "merci" },
  { message: "ok" },
  { message: "hmm" },
];

export async function evaluateSalesReplies(input?: {
  cases?: SalesReplyEvalCase[];
  productContext?: ProductContext;
}): Promise<SalesReplyEvalReport> {
  const testCases = input?.cases?.length
    ? input.cases
    : defaultSalesReplyEvalCases;
  const productContext = input?.productContext || DEFAULT_PRODUCT_CONTEXT;
  const rawResults = await Promise.all(
    testCases.map(async (testCase, index) => {
      const startedAt = Date.now();
      const result = await generateAgentResult(testCase.message, productContext, {
        customerId: testCase.customerId || `reply-eval-${index + 1}`,
        useMemory: false,
      });
      const intentResult =
        typeof testCase.expectedQuantity === "number"
          ? await analyzeAIIntentWithMeta({
              message: testCase.message,
              productContext,
            })
          : undefined;
      const detectedQuantity =
        intentResult?.intentAnalysis.entities.quantity ?? null;
      const durationMs = Date.now() - startedAt;

      return {
        message: testCase.message,
        reply: result.reply,
        source: result.source,
        durationMs,
        length: result.reply.length,
        genericFallback: result.reply.trim() === OLD_GENERIC_FALLBACK_REPLY,
        detectedQuantity,
        missingExpectedQuantity:
          typeof testCase.expectedQuantity === "number" &&
          detectedQuantity !== testCase.expectedQuantity,
      };
    }),
  );
  const replyCounts = new Map<string, number>();

  for (const result of rawResults) {
    replyCounts.set(result.reply, (replyCounts.get(result.reply) || 0) + 1);
  }

  const results = rawResults.map((result) => ({
    ...result,
    repeatedReply: (replyCounts.get(result.reply) || 0) > 1,
  }));
  const total = results.length;
  const genericFallbackCount = results.filter(
    (result) => result.genericFallback,
  ).length;
  const repeatedReplyCount = results.filter(
    (result) => result.repeatedReply,
  ).length;
  const missingQuantityCount = results.filter(
    (result) => result.missingExpectedQuantity,
  ).length;
  const avgLength = total
    ? Number(
        (
          results.reduce((sum, result) => sum + result.length, 0) / total
        ).toFixed(1),
      )
    : 0;

  return {
    summary: {
      total,
      genericFallbackCount,
      repeatedReplyCount,
      missingQuantityCount,
      avgLength,
      passed:
        genericFallbackCount === 0 &&
        repeatedReplyCount === 0 &&
        missingQuantityCount === 0,
    },
    results,
  };
}
