import { env } from "../../../config/env";
import type {
  AIIntentRouterAnalysis,
  AIIntentRouterIntent,
} from "../ai/ai-intent-router.service";
import { DEFAULT_PRODUCT_CONTEXT } from "../default-product-context";
import {
  formatPriceText,
  getDeliveryText,
  getPaymentText,
} from "../direct-answer/product-formatters";
import { normalizeText } from "../direct-answer/text-normalization";
import type { ProductContext } from "../product-context.types";
import { validateNaturalReply } from "./natural-reply.validator";
import type {
  NaturalReplyInput,
  NaturalReplyMeta,
  NaturalReplyResult,
} from "./natural-reply.types";

type OllamaGenerateResponse = {
  response?: string;
  done?: boolean;
};

type NaturalReplyCacheEntry = {
  reply: string;
  expiresAt: number;
};

const cacheTtlMs = 10 * 60 * 1000;
const maxCacheSize = 200;
const circuitOpenMs = 2 * 60 * 1000;
const naturalReplyCache = new Map<string, NaturalReplyCacheEntry>();
let warmupPromise: Promise<void> | null = null;
let consecutiveTimeouts = 0;
let circuitOpenUntil = 0;

export function getNaturalReplyConfig() {
  return {
    enabled: env.naturalReplyEnabled,
    model: env.naturalReplyModel,
    timeoutMs: env.naturalReplyTimeoutMs,
    maxTokens: env.naturalReplyMaxTokens,
    temperature: env.naturalReplyTemperature,
    topP: env.naturalReplyTopP,
    numCtx: env.naturalReplyNumCtx,
  };
}

function buildMeta(input: {
  used?: boolean;
  timedOut?: boolean;
  validationFailed?: boolean;
  durationMs?: number;
  skippedReason?: string;
  circuitOpen?: boolean;
  cacheHit?: boolean;
}): NaturalReplyMeta {
  return {
    naturalReplyUsed: input.used ?? false,
    naturalReplyTimedOut: input.timedOut ?? false,
    naturalReplyValidationFailed: input.validationFailed ?? false,
    naturalReplyDurationMs: input.durationMs ?? 0,
    naturalReplySkippedReason: input.skippedReason,
    naturalReplyCircuitOpen: input.circuitOpen ?? false,
    naturalReplyCacheHit: input.cacheHit ?? false,
    naturalReplyModel: env.naturalReplyModel,
    naturalReplyTimeoutMs: env.naturalReplyTimeoutMs,
    naturalReplyEnabled: env.naturalReplyEnabled,
  };
}

function fallbackResult(
  input: NaturalReplyInput,
  meta: Parameters<typeof buildMeta>[0],
): NaturalReplyResult {
  return {
    reply: input.deterministicReply,
    meta: buildMeta(meta),
  };
}

function getStoreAddress(productContext: ProductContext): string | undefined {
  return (
    productContext.attributes?.storeLocation ||
    productContext.attributes?.["store_location"] ||
    productContext.attributes?.["عنوان المحل"] ||
    productContext.attributes?.["المحل"]
  );
}

function buildCompactFacts(productContext: ProductContext): Record<string, unknown> {
  return {
    product: productContext.productName,
    price: formatPriceText(productContext) || undefined,
    colors: productContext.availableColors?.filter(Boolean) || [],
    sizes: productContext.availableSizes?.filter(Boolean) || [],
    delivery: getDeliveryText(productContext) || undefined,
    COD: getPaymentText(productContext) || undefined,
    offer: productContext.offer || undefined,
    store: getStoreAddress(productContext),
  };
}

function hashText(text: string): string {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

function getProductFactsHash(productContext: ProductContext): string {
  return hashText(JSON.stringify(buildCompactFacts(productContext)));
}

function getCacheKey(input: NaturalReplyInput): string {
  return [
    normalizeText(input.message),
    input.intentAnalysis.intent,
    input.intentAnalysis.subIntent || "",
    getProductFactsHash(input.productContext),
  ].join("|");
}

function getCachedReply(cacheKey: string): string | undefined {
  const entry = naturalReplyCache.get(cacheKey);

  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    naturalReplyCache.delete(cacheKey);
    return undefined;
  }

  naturalReplyCache.delete(cacheKey);
  naturalReplyCache.set(cacheKey, entry);

  return entry.reply;
}

function setCachedReply(cacheKey: string, reply: string): void {
  naturalReplyCache.set(cacheKey, {
    reply,
    expiresAt: Date.now() + cacheTtlMs,
  });

  while (naturalReplyCache.size > maxCacheSize) {
    const oldestKey = naturalReplyCache.keys().next().value as string | undefined;

    if (!oldestKey) {
      break;
    }

    naturalReplyCache.delete(oldestKey);
  }
}

function isLowValueMessage(input: NaturalReplyInput): boolean {
  const normalizedMessage = normalizeText(input.message);

  if (
    [
      "hmm",
      "hm",
      "ok",
      "okay",
      "merci",
      "thanks",
      "شكرا",
      "واخا",
      "تمام",
      "سلام",
      "salam",
      "hello",
      "hi",
    ].includes(normalizedMessage)
  ) {
    return true;
  }

  return (
    input.intentAnalysis.intent === "greeting" ||
    input.intentAnalysis.subIntent === "assistant_identity" ||
    input.intentAnalysis.subIntent === "human_check" ||
    [
      "شنو سميتك",
      "واش انسان",
      "واش إنسان",
      "nta bot",
      "wach bot",
      "who are you",
    ].some((term) => normalizedMessage.includes(normalizeText(term)))
  );
}

function hasStoreFact(productContext: ProductContext): boolean {
  return Boolean(getStoreAddress(productContext));
}

function isHighValueNaturalIntent(
  analysis: AIIntentRouterAnalysis,
  productContext: ProductContext,
): boolean {
  if (
    analysis.intent === "objection_price" ||
    analysis.intent === "negotiation" ||
    analysis.intent === "objection_trust"
  ) {
    return true;
  }

  if (analysis.intent !== "product_info_question") {
    return false;
  }

  if (
    analysis.subIntent === "comfort_question" ||
    analysis.subIntent === "usage_question" ||
    analysis.subIntent === "recommendation_request" ||
    analysis.subIntent === "popular_color"
  ) {
    return true;
  }

  return analysis.subIntent === "store_location" && !hasStoreFact(productContext);
}

export function isNaturalReplyEligible(input: NaturalReplyInput): boolean {
  if (!env.naturalReplyEnabled) {
    return false;
  }

  if (isLowValueMessage(input)) {
    return false;
  }

  if (input.orderState?.confirmed || input.orderState?.awaitingConfirmation) {
    return false;
  }

  if (
    input.orderState?.missingFields &&
    input.orderState.missingFields.length > 0
  ) {
    return false;
  }

  return isHighValueNaturalIntent(input.intentAnalysis, input.productContext);
}

function getSkipReason(input: NaturalReplyInput): string | undefined {
  if (!env.naturalReplyEnabled) {
    return "disabled";
  }

  if (isLowValueMessage(input)) {
    return "low_value_message";
  }

  if (input.orderState?.confirmed || input.orderState?.awaitingConfirmation) {
    return "order_flow";
  }

  if (
    input.orderState?.missingFields &&
    input.orderState.missingFields.length > 0
  ) {
    return "order_flow";
  }

  if (!isHighValueNaturalIntent(input.intentAnalysis, input.productContext)) {
    return "not_eligible_intent";
  }

  return undefined;
}

function buildNaturalReplyPrompt(input: NaturalReplyInput): string {
  return [
    "Darija Arabic only. Rewrite draft naturally for WhatsApp in max 2 short sentences.",
    "Use only facts. No fake discount/free delivery/reviews/comfort/store/warranty. Output reply only.",
    `msg=${JSON.stringify(input.message)}`,
    `intent=${input.intentAnalysis.intent}/${input.intentAnalysis.subIntent || ""}`,
    `draft=${JSON.stringify(input.deterministicReply)}`,
    `facts=${JSON.stringify(buildCompactFacts(input.productContext))}`,
  ].join("\n");
}

function cleanNaturalReply(reply: string): string {
  return reply
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasEnoughNaturalReply(reply: string): boolean {
  const cleanedReply = cleanNaturalReply(reply);
  const sentenceCount = cleanedReply.match(/[.!؟?]/g)?.length || 0;

  return cleanedReply.length >= 35 && (sentenceCount >= 1 || cleanedReply.length >= 90);
}

async function generateWithTimeout(prompt: string): Promise<string> {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    env.naturalReplyTimeoutMs,
  );

  try {
    const response = await fetch(`${env.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: abortController.signal,
      body: JSON.stringify({
        model: env.naturalReplyModel,
        prompt,
        stream: true,
        keep_alive: "30m",
        options: {
          temperature: env.naturalReplyTemperature,
          num_predict: env.naturalReplyMaxTokens,
          top_p: env.naturalReplyTopP,
          num_ctx: env.naturalReplyNumCtx,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Natural reply Ollama request failed with status ${response.status}: ${errorBody}`,
      );
    }

    if (!response.body) {
      throw new Error("Natural reply Ollama response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          continue;
        }

        const data = JSON.parse(trimmedLine) as OllamaGenerateResponse;
        reply += data.response || "";

        if (data.done || hasEnoughNaturalReply(reply)) {
          await reader.cancel();
          return cleanNaturalReply(reply);
        }
      }
    }

    return cleanNaturalReply(reply);
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(
        `Natural reply Ollama request timed out after ${env.naturalReplyTimeoutMs}ms`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function warmNaturalReplyModel(): Promise<void> {
  if (!env.naturalReplyEnabled || !env.naturalReplyWarmupEnabled) {
    return;
  }

  if (warmupPromise) {
    return warmupPromise;
  }

  warmupPromise = (async () => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 30000);

    try {
      const response = await fetch(`${env.ollamaBaseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: abortController.signal,
        body: JSON.stringify({
          model: env.naturalReplyModel,
          prompt: "مرحبا",
          stream: false,
          keep_alive: "30m",
          options: {
            temperature: 0,
            num_predict: 1,
            num_ctx: 128,
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Natural reply warmup failed with status ${response.status}: ${errorBody}`,
        );
      }

      await response.json();
      console.log(`🌿 Natural reply model warmed: ${env.naturalReplyModel}`);
    } catch (error) {
      console.error("❌ Natural reply model warmup failed", error);
    } finally {
      clearTimeout(timeout);
      warmupPromise = null;
    }
  })();

  return warmupPromise;
}

export function getNaturalReplyStatus() {
  const now = Date.now();

  return {
    ...getNaturalReplyConfig(),
    reason: env.naturalReplyEnabled ? undefined : "disabled_by_config",
    circuitOpen: circuitOpenUntil > now,
    consecutiveTimeouts,
    circuitResetAt:
      circuitOpenUntil > now ? new Date(circuitOpenUntil).toISOString() : null,
    cacheSize: naturalReplyCache.size,
  };
}

export function resetNaturalReplyState(): void {
  naturalReplyCache.clear();
  consecutiveTimeouts = 0;
  circuitOpenUntil = 0;
}

function buildSmokeIntent(message: string): AIIntentRouterAnalysis {
  const lowerMessage = normalizeText(message);
  const isTrust = [
    "نصابة",
    "نصاب",
    "نضمن",
    "ثقة",
    "nasaba",
    "scam",
  ].some((term) => lowerMessage.includes(normalizeText(term)));
  const isPrice = [
    "غالي",
    "غالية",
    "ناقصة",
    "نقص",
    "rkhis",
    "ghali",
  ].some((term) => lowerMessage.includes(normalizeText(term)));
  const intent: AIIntentRouterIntent = isTrust
    ? "objection_trust"
    : isPrice
      ? "objection_price"
      : "product_info_question";

  return {
    intent,
    subIntent: intent === "product_info_question" ? "recommendation_request" : null,
    entities: {
      size: null,
      color: null,
      city: null,
      quantity: null,
      phone: null,
      fullName: null,
      address: null,
    },
    language: "darija",
    customerMood: isPrice ? "price_sensitive" : "interested",
    salesStage: isPrice || isTrust ? "comparing" : "asking_info",
    salesOpportunity: true,
    shouldUseDirectAnswer: false,
    shouldContinueOrderFlow: false,
    confidence: 0.9,
  };
}

function buildSmokeDraft(message: string): string {
  const normalizedMessage = normalizeText(message);

  if (
    ["نصابة", "نصاب", "نضمن", "ثقة", "nasaba", "scam"].some((term) =>
      normalizedMessage.includes(normalizeText(term)),
    )
  ) {
    return "عندك الحق تسولي. باش ترتاحي، الدفع كاين حتى توصلك السلعة، وغادي نأكدو معاك التفاصيل قبل الإرسال.";
  }

  if (
    ["غالي", "غالية", "ناقصة", "نقص", "ghali"].some((term) =>
      normalizedMessage.includes(normalizeText(term)),
    )
  ) {
    return "فاهمك، الثمن مهم. هادي ب 179 درهم والميزة أن الدفع حتى توصلك السلعة. إذا عجباتك نقدر نثبت لك اللون والمقاس.";
  }

  return "نقدر نعاونك تختاري حسب اللون والمقاس المتوفر. شنو كيعجبك أكثر؟";
}

export async function smokeTestNaturalReply(message: string) {
  const startedAt = Date.now();
  const result = await generateNaturalReply({
    message,
    productContext: DEFAULT_PRODUCT_CONTEXT,
    intentAnalysis: buildSmokeIntent(message),
    deterministicReply: buildSmokeDraft(message),
  });

  return {
    message,
    reply: result.reply,
    model: env.naturalReplyModel,
    durationMs: Date.now() - startedAt,
    timedOut: result.meta.naturalReplyTimedOut,
    validationFailed: result.meta.naturalReplyValidationFailed,
    skippedReason: result.meta.naturalReplySkippedReason,
    naturalReplyUsed: result.meta.naturalReplyUsed,
    circuitOpen: result.meta.naturalReplyCircuitOpen,
    cacheHit: result.meta.naturalReplyCacheHit,
  };
}

export async function generateNaturalReply(
  input: NaturalReplyInput,
): Promise<NaturalReplyResult> {
  const startedAt = Date.now();
  const skipReason = getSkipReason(input);

  if (skipReason) {
    return fallbackResult(input, {
      skippedReason: skipReason,
      durationMs: Date.now() - startedAt,
    });
  }

  if (Date.now() < circuitOpenUntil) {
    return fallbackResult(input, {
      skippedReason: "circuit_open",
      circuitOpen: true,
      durationMs: Date.now() - startedAt,
    });
  }

  const cacheKey = getCacheKey(input);
  const cachedReply = getCachedReply(cacheKey);

  if (cachedReply) {
    return {
      reply: cachedReply,
      meta: buildMeta({
        used: true,
        cacheHit: true,
        durationMs: Date.now() - startedAt,
      }),
    };
  }

  try {
    const reply = await generateWithTimeout(buildNaturalReplyPrompt(input));
    const validation = validateNaturalReply(reply, input.productContext);

    if (!validation.isValid) {
      return fallbackResult(input, {
        validationFailed: true,
        durationMs: Date.now() - startedAt,
      });
    }

    consecutiveTimeouts = 0;
    setCachedReply(cacheKey, reply);

    return {
      reply,
      meta: buildMeta({
        used: true,
        durationMs: Date.now() - startedAt,
      }),
    };
  } catch (error) {
    const timedOut =
      error instanceof Error && error.message.toLowerCase().includes("timed out");
    let circuitOpen = false;

    if (timedOut) {
      consecutiveTimeouts += 1;

      if (consecutiveTimeouts >= 2) {
        circuitOpenUntil = Date.now() + circuitOpenMs;
        circuitOpen = true;
      }
    } else {
      console.error("❌ Natural reply generation failed", error);
    }

    return fallbackResult(input, {
      timedOut,
      circuitOpen,
      skippedReason: circuitOpen ? "circuit_open" : undefined,
      durationMs: Date.now() - startedAt,
    });
  }
}
