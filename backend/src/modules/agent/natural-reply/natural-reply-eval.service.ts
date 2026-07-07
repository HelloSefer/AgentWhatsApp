import { analyzeAIIntentWithMeta } from "../ai/ai-intent-router.service";
import { DEFAULT_PRODUCT_CONTEXT } from "../default-product-context";
import { buildSalesResponse } from "../sales/sales-response.builder";
import type { ProductContext } from "../product-context.types";
import {
  generateNaturalReply,
  getNaturalReplyConfig,
  resetNaturalReplyState,
} from "./natural-reply-generator.service";

export interface NaturalReplyEvalCase {
  message: string;
}

export interface NaturalReplyEvalResult {
  message: string;
  intent: string;
  deterministicReply: string;
  finalReply: string;
  naturalReplyUsed: boolean;
  naturalReplySkippedReason?: string;
  timedOut: boolean;
  validationFailed: boolean;
  circuitOpen: boolean;
  cacheHit: boolean;
  durationMs: number;
  naturalReplyModel: string;
  timeoutMs: number;
}

export interface NaturalReplyEvalReport {
  summary: {
    total: number;
    naturalUsedCount: number;
    skippedCount: number;
    cacheHitCount: number;
    fallbackCount: number;
    timedOutCount: number;
    validationFailedCount: number;
    circuitOpenCount: number;
    avgDurationMs: number;
    passed: boolean;
  };
  results: NaturalReplyEvalResult[];
}

export interface NaturalReplyBenchmarkReport {
  summary: {
    total: number;
    naturalUsedCount: number;
    fallbackCount: number;
    timedOutCount: number;
    validationFailedCount: number;
    circuitOpenCount: number;
    cacheHitCount: number;
    avgDurationMs: number;
    maxDurationMs: number;
    passed: boolean;
  };
  config: ReturnType<typeof getNaturalReplyConfig>;
  results: Array<{
    message: string;
    finalReply: string;
    naturalReplyUsed: boolean;
    timedOut: boolean;
    validationFailed: boolean;
    circuitOpen: boolean;
    cacheHit: boolean;
    skippedReason?: string;
    durationMs: number;
  }>;
}

const defaultNaturalReplyEvalCases: NaturalReplyEvalCase[] = [
  { message: "صراحة غالية عليا" },
  { message: "لقيتها ناقصة فبلاصة أخرى" },
  { message: "واش ماشي نصابة" },
  { message: "كيفاش نضمن توصلي السلعة؟" },
  { message: "واش كتجي مريحة" },
  { message: "بغيتها للخروج واش زوينة" },
  { message: "راني محتارة شنو ناخد" },
  { message: "شنو اللون لي خارج أكثر" },
  { message: "فين نقدر نشوفها" },
  { message: "hmm" },
  { message: "شنو سميتك" },
];

const naturalReplyBenchmarkCases: NaturalReplyEvalCase[] = [
  { message: "صراحة غالية عليا" },
  { message: "لقيتها ناقصة فبلاصة أخرى" },
  { message: "واش ماشي نصابة" },
  { message: "كيفاش نضمن توصلي السلعة؟" },
  { message: "واش كتجي مريحة" },
  { message: "راني محتارة شنو ناخد" },
];

export async function evaluateNaturalReplies(input?: {
  cases?: NaturalReplyEvalCase[];
  productContext?: ProductContext;
}): Promise<NaturalReplyEvalReport> {
  const testCases = input?.cases?.length
    ? input.cases
    : defaultNaturalReplyEvalCases;
  const productContext = input?.productContext || DEFAULT_PRODUCT_CONTEXT;
  const results: NaturalReplyEvalResult[] = [];

  for (const testCase of testCases) {
    const startedAt = Date.now();
    const { intentAnalysis } = await analyzeAIIntentWithMeta({
      message: testCase.message,
      productContext,
    });
    const deterministicResponse = buildSalesResponse({
      message: testCase.message,
      productContext,
      analysis: intentAnalysis,
    });
    const naturalResponse = await generateNaturalReply({
      message: testCase.message,
      productContext,
      intentAnalysis,
      deterministicReply: deterministicResponse.reply,
    });

    results.push({
      message: testCase.message,
      intent: intentAnalysis.intent,
      deterministicReply: deterministicResponse.reply,
      finalReply: naturalResponse.reply,
      naturalReplyUsed: naturalResponse.meta.naturalReplyUsed,
      naturalReplySkippedReason: naturalResponse.meta.naturalReplySkippedReason,
      timedOut: naturalResponse.meta.naturalReplyTimedOut,
      validationFailed: naturalResponse.meta.naturalReplyValidationFailed,
      circuitOpen: naturalResponse.meta.naturalReplyCircuitOpen,
      cacheHit: naturalResponse.meta.naturalReplyCacheHit,
      durationMs: Date.now() - startedAt,
      naturalReplyModel: naturalResponse.meta.naturalReplyModel,
      timeoutMs: naturalResponse.meta.naturalReplyTimeoutMs,
    });
  }
  const total = results.length;
  const naturalUsedCount = results.filter(
    (result) => result.naturalReplyUsed,
  ).length;
  const timedOutCount = results.filter((result) => result.timedOut).length;
  const skippedCount = results.filter(
    (result) => Boolean(result.naturalReplySkippedReason),
  ).length;
  const cacheHitCount = results.filter((result) => result.cacheHit).length;
  const validationFailedCount = results.filter(
    (result) => result.validationFailed,
  ).length;
  const circuitOpenCount = results.filter((result) => result.circuitOpen).length;
  const fallbackCount = total - naturalUsedCount;
  const avgDurationMs = total
    ? Number(
        (
          results.reduce((sum, result) => sum + result.durationMs, 0) / total
        ).toFixed(1),
      )
    : 0;

  return {
    summary: {
      ...getNaturalReplyConfig(),
      total,
      naturalUsedCount,
      skippedCount,
      cacheHitCount,
      fallbackCount,
      timedOutCount,
      validationFailedCount,
      circuitOpenCount,
      avgDurationMs,
      passed:
        timedOutCount <= 2 &&
        validationFailedCount === 0 &&
        results.every((result) => result.finalReply.trim()),
    },
    results,
  };
}

export async function benchmarkNaturalReplies(input?: {
  productContext?: ProductContext;
}): Promise<NaturalReplyBenchmarkReport> {
  resetNaturalReplyState();

  const report = await evaluateNaturalReplies({
    productContext: input?.productContext,
    cases: naturalReplyBenchmarkCases,
  });
  const maxDurationMs = report.results.length
    ? Math.max(...report.results.map((result) => result.durationMs))
    : 0;

  return {
    summary: {
      total: report.summary.total,
      naturalUsedCount: report.summary.naturalUsedCount,
      fallbackCount: report.summary.fallbackCount,
      timedOutCount: report.summary.timedOutCount,
      validationFailedCount: report.summary.validationFailedCount,
      circuitOpenCount: report.summary.circuitOpenCount,
      cacheHitCount: report.summary.cacheHitCount,
      avgDurationMs: report.summary.avgDurationMs,
      maxDurationMs,
      passed:
        report.summary.validationFailedCount === 0 &&
        report.summary.timedOutCount <= 2 &&
        report.results.every((result) => result.finalReply.trim()),
    },
    config: getNaturalReplyConfig(),
    results: report.results.map((result) => ({
      message: result.message,
      finalReply: result.finalReply,
      naturalReplyUsed: result.naturalReplyUsed,
      timedOut: result.timedOut,
      validationFailed: result.validationFailed,
      circuitOpen: result.circuitOpen,
      cacheHit: result.cacheHit,
      skippedReason: result.naturalReplySkippedReason,
      durationMs: result.durationMs,
    })),
  };
}
