import { generateAIReply } from "../ai/ai.service";
import { buildMoroccanSalesPrompt } from "./prompt.builder";
import { DEFAULT_PRODUCT_CONTEXT } from "./default-product-context";
import { getDirectAgentReply } from "./direct-answer.service";
import { processOrderTurn } from "./order/order-state.service";
import { appendConversationMessage } from "./session/conversation-session.service";
import type { AgentResult } from "./agent-action.types";
import type { ProductContext } from "./product-context.types";

type GenerateAgentOptions = {
  customerId?: string;
  sellerId?: string;
  productId?: string;
  useMemory?: boolean;
};

const MAX_REPLY_LENGTH = 280;
const SAFE_FALLBACK_REPLY = "سمح ليا، نقدر نعاونك فمعلومات المنتج أو التوصيل.";
const badPhraseReplacements: Array<[RegExp, string]> = [
  [/الأوردي/g, "الوردي"],
  [/دفع الأموال/g, "تخلص"],
  [/إذا شفتلك/g, "إذا بغيتي"],
  [/شفتلك/g, "بغيتي"],
  [/مشغولة بالمتاعب/g, ""],
  [/المتاعب/g, ""],
  [/لمتاعبنا/g, ""],
  [/متوفرا/g, "متوفر"],
  [/فيوادك/g, "بغيتي"],
  [/تتخليص/g, "تخلص"],
  [/نتدارس/g, "نوضح لك"],
  [/نرسللك/g, "نرسل لك"],
];
const chineseCharacterPattern = /[\u4e00-\u9fff]/;
const cyrillicCharacterPattern = /[\u0400-\u04ff]/;

function removeSurroundingQuotes(text: string): string {
  const trimmed = text.trim();
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["«", "»"],
  ];

  for (const [openQuote, closeQuote] of quotePairs) {
    if (trimmed.startsWith(openQuote) && trimmed.endsWith(closeQuote)) {
      return trimmed.slice(openQuote.length, -closeQuote.length).trim();
    }
  }

  return trimmed;
}

function replaceKnownBadPhrases(text: string): string {
  return badPhraseReplacements.reduce(
    (cleaned, [pattern, replacement]) => cleaned.replace(pattern, replacement),
    text,
  );
}

function normalizeSpacing(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([،.!؟?])/g, "$1")
    .replace(/،\s*،/g, "،")
    .replace(/^\s*[،.!؟?]\s*/g, "")
    .trim();
}

function looksPolluted(text: string): boolean {
  if (chineseCharacterPattern.test(text) || cyrillicCharacterPattern.test(text)) {
    return true;
  }

  const arabicLetters = text.match(/[\u0600-\u06ff]/g)?.length || 0;
  const latinLetters = text.match(/[a-z]/gi)?.length || 0;

  return latinLetters > 40 && latinLetters > arabicLetters;
}

function cleanAgentReply(reply: string): string {
  if (looksPolluted(reply)) {
    return SAFE_FALLBACK_REPLY;
  }

  const cleaned = normalizeSpacing(
    replaceKnownBadPhrases(removeSurroundingQuotes(reply)),
  );

  if (looksPolluted(cleaned)) {
    return SAFE_FALLBACK_REPLY;
  }

  const sentences = cleaned.match(/[^.!؟?]+[.!؟?]*/g);
  const shortReply = normalizeSpacing(
    sentences ? sentences.slice(0, 2).join("").trim() : cleaned,
  );

  if (shortReply.length <= MAX_REPLY_LENGTH) {
    return shortReply;
  }

  return normalizeSpacing(shortReply.slice(0, MAX_REPLY_LENGTH));
}

async function appendMessageToMemory(
  options: GenerateAgentOptions | undefined,
  role: "customer" | "agent",
  text: string,
): Promise<void> {
  if (!options?.useMemory || !options.customerId) {
    return;
  }

  try {
    await appendConversationMessage({
      customerId: options.customerId,
      sellerId: options.sellerId,
      productId: options.productId,
      role,
      text,
    });
  } catch (error) {
    console.error("❌ Conversation memory append failed", error);
  }
}

async function buildAgentResult(
  userMessage: string,
  productContext: ProductContext,
): Promise<AgentResult> {
  const directReply = getDirectAgentReply(userMessage, productContext);

  if (directReply) {
    return {
      reply: cleanAgentReply(directReply.reply),
      actions: directReply.actions ?? [],
      source: "direct",
    };
  }

  const prompt = buildMoroccanSalesPrompt(userMessage, productContext);
  const reply = await generateAIReply(prompt);

  return {
    reply: cleanAgentReply(reply),
    actions: [],
    source: "ai_fallback",
  };
}

async function buildOrderResultIfHandled(
  userMessage: string,
  productContext: ProductContext,
  options?: GenerateAgentOptions,
): Promise<AgentResult | null> {
  if (!options?.useMemory || !options.customerId) {
    return null;
  }

  try {
    const orderResult = await processOrderTurn({
      customerId: options.customerId,
      sellerId: options.sellerId,
      productId: options.productId,
      message: userMessage,
      productContext,
    });

    if (!orderResult.handled || !orderResult.reply) {
      return null;
    }

    return {
      reply: cleanAgentReply(orderResult.reply),
      actions: [],
      source: "direct",
    };
  } catch (error) {
    console.error("❌ Order state processing failed", error);
    return null;
  }
}

export async function generateAgentResult(
  message: string,
  productContext: ProductContext = DEFAULT_PRODUCT_CONTEXT,
  options?: GenerateAgentOptions,
): Promise<AgentResult> {
  const userMessage = message.trim();

  if (!userMessage) {
    throw new Error("Message is required");
  }

  await appendMessageToMemory(options, "customer", userMessage);

  const result =
    (await buildOrderResultIfHandled(userMessage, productContext, options)) ||
    (await buildAgentResult(userMessage, productContext));

  await appendMessageToMemory(options, "agent", result.reply);

  return result;
}

export async function generateAgentReply(
  message: string,
  productContext: ProductContext = DEFAULT_PRODUCT_CONTEXT,
  options?: GenerateAgentOptions,
): Promise<string> {
  const result = await generateAgentResult(message, productContext, options);

  return result.reply;
}
