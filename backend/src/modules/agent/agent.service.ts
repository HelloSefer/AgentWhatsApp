import { DEFAULT_PRODUCT_CONTEXT } from "./default-product-context";
import { getDirectAgentReply } from "./direct-answer.service";
import { analyzeAIIntentWithMeta } from "./ai/ai-intent-router.service";
import type { AIIntentRouterAnalysis } from "./ai/ai-intent-router.service";
import { getOrderReply } from "./direct-answer/reply-builders";
import { includesAny } from "./direct-answer/text-normalization";
import {
  generateNaturalReply,
  getNaturalReplyStatus,
} from "./natural-reply/natural-reply-generator.service";
import { processOrderTurn } from "./order/order-state.service";
import { buildSalesResponse } from "./sales/sales-response.builder";
import {
  buildSellerBrainResponse,
  canSellerBrainHandle,
} from "./seller-brain/seller-brain-response.service";
import {
  appendConversationMessage,
  appendSellerBrainReplyKey,
  getConversationSession,
} from "./session/conversation-session.service";
import type { AgentIdentity } from "./identity/agent-identity.types";
import { conversationKeyService } from "./identity/conversation-key.service";
import { DEFAULT_DEMO_SELLER_ID } from "./identity/seller-resolver.service";
import type {
  AgentAction,
  AgentOrderStateSummary,
  AgentResult,
} from "./agent-action.types";
import type { OrderEntities } from "./agent-brain.types";
import type { ProductContext } from "./product-context.types";

export type GenerateAgentOptions = {
  customerId?: string;
  customerPhone?: string;
  conversationKey?: string;
  sellerId?: string;
  productId?: string;
  phoneNumberId?: string;
  useMemory?: boolean;
};

const MAX_REPLY_LENGTH = 280;
const SAFE_FALLBACK_REPLY = "سمح ليا، نقدر نعاونك فمعلومات المنتج أو التوصيل.";
const SAFE_ROUTER_FALLBACK_REPLY =
  "نقدر نعاونك فالثمن، التوصيل، الألوان، المقاسات أو الطلب.";
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

function cleanOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed || undefined;
}

function getCustomerPhoneFromConversationKey(
  conversationKey: string | undefined,
  sellerId: string,
): string | undefined {
  const cleanConversationKey = cleanOptionalText(conversationKey);

  if (!cleanConversationKey) {
    return undefined;
  }

  const prefix = `${sellerId}:`;

  if (cleanConversationKey.startsWith(prefix)) {
    return cleanOptionalText(cleanConversationKey.slice(prefix.length));
  }

  const separatorIndex = cleanConversationKey.indexOf(":");

  if (separatorIndex >= 0) {
    return cleanOptionalText(cleanConversationKey.slice(separatorIndex + 1));
  }

  return cleanConversationKey;
}

export function resolveAgentIdentity(
  options?: GenerateAgentOptions,
): AgentIdentity | undefined {
  const hasIdentityInput = Boolean(
    options?.customerId ||
      options?.sellerId ||
      options?.customerPhone ||
      options?.conversationKey ||
      options?.phoneNumberId,
  );

  if (!hasIdentityInput) {
    return undefined;
  }

  const sellerId = cleanOptionalText(options?.sellerId) || DEFAULT_DEMO_SELLER_ID;
  const conversationKey = cleanOptionalText(options?.conversationKey);
  const customerPhone =
    cleanOptionalText(options?.customerPhone) ||
    getCustomerPhoneFromConversationKey(conversationKey, sellerId) ||
    cleanOptionalText(options?.customerId);

  if (!customerPhone && !conversationKey) {
    return undefined;
  }

  return {
    sellerId,
    customerPhone: customerPhone || conversationKey || "",
    conversationKey:
      conversationKey ||
      conversationKeyService.buildConversationKey(sellerId, customerPhone || ""),
    phoneNumberId: cleanOptionalText(options?.phoneNumberId),
  };
}

function normalizeAgentOptions(options?: GenerateAgentOptions): {
  options?: GenerateAgentOptions;
  identity?: AgentIdentity;
} {
  const identity = resolveAgentIdentity(options);

  if (!identity) {
    return { options, identity };
  }

  return {
    identity,
    options: {
      ...options,
      customerId: identity.conversationKey,
      customerPhone: identity.customerPhone,
      conversationKey: identity.conversationKey,
      sellerId: identity.sellerId,
      phoneNumberId: identity.phoneNumberId,
    },
  };
}

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

function formatNaturalList(items: string[]): string {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);

  if (cleanItems.length <= 1) {
    return cleanItems.join("");
  }

  return `${cleanItems.slice(0, -1).join("، ")} و${
    cleanItems[cleanItems.length - 1]
  }`;
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
      customerPhone: options.customerPhone,
      conversationKey: options.conversationKey,
      sellerId: options.sellerId,
      productId: options.productId,
      role,
      text,
    });
  } catch (error) {
    console.error("❌ Conversation memory append failed", error);
  }
}

function toOrderEntities(analysis: AIIntentRouterAnalysis): OrderEntities {
  return Object.fromEntries(
    Object.entries(analysis.entities).filter(([, value]) => {
      if (typeof value === "number") {
        return Number.isFinite(value) && value > 0;
      }

      return typeof value === "string" ? Boolean(value.trim()) : false;
    }),
  ) as OrderEntities;
}

function mightBeOrderMessage(message: string): boolean {
  return (
    includesAny(message, [
      "bghit",
      "بغيت",
      "ncommande",
      "ncommandi",
      "ncommander",
      "nakhod",
      "nakhoud",
      "khoud lia",
      "khod lia",
      "نطلب",
      "نكوموندي",
      "نكومندي",
      "خود ليا",
      "خذ ليا",
    ]) &&
    (/\b(3[6-9]|4[0-5]|[1-9])\b/.test(message) ||
      includesAny(message, [
        "wa7da",
        "wahda",
        "جوج",
        "زوج",
        "واحدة",
        "كازا",
        "casa",
        "الدار البيضاء",
        "مراكش",
        "rabat",
        "fes",
        "طنجة",
        "pointure",
        "مقاس",
      ]))
  );
}

function shouldUseSmartRouterBeforeDirect(message: string): boolean {
  const isPersonaOrProductOverview = includesAny(message, [
    "شنو سميتك",
    "اش سميتك",
    "سميتك",
    "smitk",
    "who are you",
    "nta bot",
    "wach bot",
    "واش بوت",
    "واش إنسان",
    "واش انسان",
    "are you human",
    "شنو هو المنتوج",
    "شنو المنتوج",
    "شنو المنتج",
    "شنو السلعة",
    "شنو كتبيعو",
    "شنو كتبيع",
    "اش كتبيعو",
    "شنو عندكم",
    "what do you sell",
    "what are you selling",
    "chno katbi3o",
    "xno katbi3o",
    "شنو اللون لي خارج",
    "لون خارج",
    "خارج أكثر",
    "خارج كثر",
    "الأكثر طلبا",
    "الاكثر طلبا",
    "راني محتارة",
    "محتارة شنو ناخد",
    "محتار شنو ناخد",
    "شنو تنصحني",
    "شنو ناخد",
    "بغيتها للخروج",
    "واش كتجي مريحة",
    "مريحة",
    "فين نقدر نشوفها",
    "آخر ثمن",
    "اخر ثمن",
  ]);
  const isTrustConcern = includesAny(message, [
    "نضمن",
    "ضمان",
    "ثقة",
    "نصاب",
    "نصابة",
    "nasaba",
    "mashi nasaba",
    "اراء",
    "آراء",
    "reviews",
    "avis",
  ]);
  const isDeliveryCostQuestion =
    includesAny(message, [
      "التوصيل",
      "توصيل",
      "livraison",
      "delivery",
    ]) &&
    includesAny(message, [
      "شحال",
      "ثمن",
      "تمن",
      "bch7al",
      "bchhal",
      "cost",
      "fee",
      "مجاني",
    ]);

  return isPersonaOrProductOverview || isTrustConcern || isDeliveryCostQuestion;
}

function shouldBuildDirectReplyWithSalesVoice(message: string): boolean {
  return includesAny(message, [
    "سلام",
    "salam",
    "hello",
    "merci",
    "ok",
    "hmm",
    "شحال",
    "الثمن",
    "التمن",
    "ثمن",
    "تمن",
    "price",
    "prix",
    "bch7al",
    "bach7l",
    "bachhal",
    "bach7al",
    "bch7l",
    "ch7al",
    "chhal",
    "لون",
    "ألوان",
    "الوان",
    "color",
    "couleur",
    "مقاس",
    "قياس",
    "size",
    "taille",
    "توصيل",
    "الدفع",
    "livraison",
    "delivery",
    "صورة",
    "صور",
    "تصاور",
    "photo",
    "شنو كتبيعو",
    "شنو عندكم",
    "xno katbi3o",
    "chno katbi3o",
    "تنصحني",
    "محتارة",
    "شنو ناخد",
    "خارج",
    "مريحة",
    "للخروج",
    "فين نقدر نشوفها",
    "نضمن",
    "نصابة",
    "آخر ثمن",
    "اخر ثمن",
  ]);
}

function getAvailableSizes(productContext: ProductContext): string[] {
  return productContext.availableSizes?.map((size) => size.trim()).filter(Boolean) || [];
}

function hasExplicitSize(message: string): boolean {
  return /\b(3[6-9]|4[0-5]|xxl|xl|xs|s|m|l)\b/i.test(message);
}

function isSizeListQuestion(message: string): boolean {
  return (
    !hasExplicitSize(message) &&
    includesAny(message, [
      "شنو المقاسات",
      "شنو السايزات",
      "المقاسات",
      "السايزات",
      "sizes",
      "size?",
      "pointures",
      "pointure?",
      "شنو القياسات",
      "القياسات",
    ])
  );
}

function buildSizeChoiceAction(
  productContext: ProductContext,
  body?: string,
  includeBodyInFallback = false,
  context: "missing_size" | "change_size" | "size_question" = "size_question",
): AgentAction | null {
  const sizes = getAvailableSizes(productContext);

  if (!sizes.length) {
    return null;
  }

  return {
    type: "choice_list",
    choiceType: "size",
    context,
    title: "اختيار المقاس",
    body: body || "اختاري المقاس ديالك",
    buttonText: "اختاري المقاس",
    options: sizes.map((size) => ({
      id: `size:${size}`,
      label: size,
    })),
    fallbackText: `${includeBodyInFallback && body ? `${body}\n\n` : ""}المقاسات المتوفرة هي: ${formatNaturalList(
      sizes,
    )}. جاوبي غير بالمقاس اللي بغيتي.`,
  };
}

function hasChoiceListAction(actions: AgentAction[]): boolean {
  return actions.some((action) => action.type === "choice_list");
}

function withChoiceListActions(input: {
  result: AgentResult;
  userMessage: string;
  productContext: ProductContext;
  orderStateSummary?: AgentOrderStateSummary;
}): AgentAction[] {
  const actions = [...input.result.actions];

  if (hasChoiceListAction(actions)) {
    return actions;
  }

  const orderState = input.orderStateSummary;
  const isActiveOrder =
    Boolean(orderState) &&
    !orderState?.confirmed &&
    (Boolean(orderState?.missingFields.length) ||
      Boolean(orderState?.isComplete) ||
      Boolean(Object.keys(orderState?.collected || {}).length));
  const hasCollectedSize = Boolean(orderState?.collected?.size);
  const isSizeMissing =
    isActiveOrder && orderState?.missingFields.includes("size") === true;
  const isAskedSizeList = isSizeListQuestion(input.userMessage);
  const needsSizeChoice = isAskedSizeList || isSizeMissing;

  if (!needsSizeChoice) {
    return actions;
  }

  const context = isSizeMissing
    ? "missing_size"
    : isActiveOrder && hasCollectedSize && isAskedSizeList
      ? "change_size"
      : "size_question";
  const body =
    context === "size_question"
      ? "المقاسات المتوفرة هي هادو. اختاري المقاس ديالك:"
      : context === "change_size"
        ? buildChangeSizeChoiceBody(input.productContext, orderState)
        : `${input.result.reply}\n\nاختاري المقاس من اللائحة باش نكمل الطلب:`;
  const choiceAction = buildSizeChoiceAction(
    input.productContext,
    body,
    context !== "size_question",
    context,
  );

  return choiceAction ? [...actions, choiceAction] : actions;
}

function buildMissingFieldsReminder(missingFields: string[]): string {
  const labels: Record<string, string> = {
    fullName: "الاسم الكامل",
    phone: "رقم الهاتف",
    city: "المدينة",
    address: "العنوان",
    color: "اللون",
    size: "المقاس",
    quantity: "الكمية",
  };
  const readableFields = missingFields
    .filter((field) => field !== "size")
    .map((field) => labels[field] || field);

  if (!readableFields.length) {
    return "";
  }

  return ` باقي خاصني ${formatNaturalList(readableFields)} باش نكمل الطلب.`;
}

function buildChangeSizeChoiceBody(
  productContext: ProductContext,
  orderState?: AgentOrderStateSummary,
): string {
  const currentSize = orderState?.collected?.size;
  const sizes = getAvailableSizes(productContext);
  const currentSizeText = currentSize
    ? `المقاس اللي عندي دابا هو ${currentSize}. `
    : "";

  return `${currentSizeText}المقاسات المتوفرة هي: ${formatNaturalList(
    sizes,
  )}. إذا بغيتي تبدلي المقاس اختاري واحد منهم.${buildMissingFieldsReminder(
    orderState?.missingFields || [],
  )}`;
}

async function getSellerBrainRecentReplyKeys(
  options?: GenerateAgentOptions,
): Promise<string[] | undefined> {
  if (!options?.useMemory || !options.customerId) {
    return undefined;
  }

  try {
    const session = await getConversationSession(
      options.customerId,
      options.sellerId,
      options.productId,
      options.customerPhone,
    );

    return session.sellerBrain?.recentReplyKeys;
  } catch (error) {
    console.error("❌ Seller brain memory read failed", error);
    return undefined;
  }
}

async function saveSellerBrainReplyMemory(input: {
  options?: GenerateAgentOptions;
  replyKey: string;
  intent: string;
  fallbackRecentReplyKeys?: string[];
}): Promise<string[] | undefined> {
  if (!input.options?.useMemory || !input.options.customerId) {
    return input.fallbackRecentReplyKeys;
  }

  try {
    const session = await appendSellerBrainReplyKey({
      customerId: input.options.customerId,
      customerPhone: input.options.customerPhone,
      conversationKey: input.options.conversationKey,
      sellerId: input.options.sellerId,
      productId: input.options.productId,
      replyKey: input.replyKey,
      intent: input.intent,
    });

    return session.sellerBrain?.recentReplyKeys;
  } catch (error) {
    console.error("❌ Seller brain memory update failed", error);
    return input.fallbackRecentReplyKeys;
  }
}

async function getOrderStateSummary(
  options?: GenerateAgentOptions,
): Promise<AgentOrderStateSummary | undefined> {
  if (!options?.useMemory || !options.customerId) {
    return undefined;
  }

  try {
    const session = await getConversationSession(
      options.customerId,
      options.sellerId,
      options.productId,
      options.customerPhone,
    );

    return {
      isComplete: session.orderState.isComplete,
      awaitingConfirmation: session.orderState.awaitingConfirmation,
      confirmed: session.orderState.confirmed,
      missingFields: session.orderState.missingFields,
      collected: session.orderState.collected,
    };
  } catch (error) {
    console.error("❌ Order state summary read failed", error);
    return undefined;
  }
}

async function buildOrderResultFromRouter(input: {
  userMessage: string;
  productContext: ProductContext;
  options?: GenerateAgentOptions;
  analysis: AIIntentRouterAnalysis;
}): Promise<AgentResult> {
  if (input.options?.useMemory && input.options.customerId) {
    const orderResult = await processOrderTurn({
      customerId: input.options.customerId,
      customerPhone: input.options.customerPhone,
      sellerId: input.options.sellerId,
      productId: input.options.productId,
      message: input.userMessage,
      productContext: input.productContext,
      analysis: {
        intent: input.analysis.intent,
        entities: toOrderEntities(input.analysis),
      },
    });

    if (orderResult.handled && orderResult.reply) {
      return {
        reply: orderResult.reply,
        actions: [],
        source: "ai_router",
      };
    }
  }

  return {
    reply: getOrderReply(input.productContext),
    actions: [],
    source: "ai_router",
  };
}

async function buildSmartOrderResultIfLikely(
  userMessage: string,
  productContext: ProductContext,
  options?: GenerateAgentOptions,
): Promise<AgentResult | null> {
  if (!options?.useMemory || !options.customerId || !mightBeOrderMessage(userMessage)) {
    return null;
  }

  try {
    const { intentAnalysis, meta: routerMeta } = await analyzeAIIntentWithMeta({
      message: userMessage,
      productContext,
    });

    if (
      intentAnalysis.intent !== "order_start" &&
      intentAnalysis.intent !== "order_followup"
    ) {
      return null;
    }

    const orderResult = await buildOrderResultFromRouter({
      userMessage,
      productContext,
      options,
      analysis: intentAnalysis,
    });

    return {
      ...orderResult,
      meta: {
        ...orderResult.meta,
        intentRouterUsedAI: routerMeta.usedAI,
        intentRouterTimedOut: routerMeta.timedOut,
        intentRouterDurationMs: routerMeta.durationMs,
      },
    };
  } catch (error) {
    console.error("❌ Smart order router rescue failed", error);
    return null;
  }
}

async function buildSmartRouterResult(
  userMessage: string,
  productContext: ProductContext,
  options?: GenerateAgentOptions,
): Promise<AgentResult | null> {
  try {
    const { intentAnalysis, meta: routerMeta } = await analyzeAIIntentWithMeta({
      message: userMessage,
      productContext,
    });

    if (
      intentAnalysis.intent === "order_start" ||
      intentAnalysis.intent === "order_followup"
    ) {
      const orderResult = await buildOrderResultFromRouter({
        userMessage,
        productContext,
        options,
        analysis: intentAnalysis,
      });

      return {
        ...orderResult,
        meta: {
          ...orderResult.meta,
          intentRouterUsedAI: routerMeta.usedAI,
          intentRouterTimedOut: routerMeta.timedOut,
          intentRouterDurationMs: routerMeta.durationMs,
        },
      };
    }

    if (canSellerBrainHandle(intentAnalysis)) {
      const recentReplyKeys = await getSellerBrainRecentReplyKeys(options);
      const sellerBrainResponse = buildSellerBrainResponse({
        message: userMessage,
        customerId: options?.customerId,
        productContext,
        intentAnalysis,
        recentReplyKeys,
      });
      const updatedRecentReplyKeys = await saveSellerBrainReplyMemory({
        options,
        replyKey: sellerBrainResponse.replyKey,
        intent: intentAnalysis.intent,
        fallbackRecentReplyKeys: recentReplyKeys,
      });

      return {
        reply: cleanAgentReply(sellerBrainResponse.reply),
        actions: [],
        source: "seller_brain",
        meta: {
          sellerBrainReplyKey: sellerBrainResponse.replyKey,
          sellerBrainRecentReplyKeys: updatedRecentReplyKeys,
          intentRouterUsedAI: routerMeta.usedAI,
          intentRouterTimedOut: routerMeta.timedOut,
          intentRouterDurationMs: routerMeta.durationMs,
        },
      };
    }

    const salesResponse = buildSalesResponse({
      message: userMessage,
      productContext,
      analysis: intentAnalysis,
      customerId: options?.customerId,
    });
    const deterministicReply = cleanAgentReply(salesResponse.reply);
    const naturalReply = await generateNaturalReply({
      message: userMessage,
      productContext,
      intentAnalysis,
      deterministicReply,
    });

    return {
      reply: cleanAgentReply(naturalReply.reply),
      actions: salesResponse.actions,
      source: "ai_router",
      meta: {
        ...naturalReply.meta,
        intentRouterUsedAI: routerMeta.usedAI,
        intentRouterTimedOut: routerMeta.timedOut,
        intentRouterDurationMs: routerMeta.durationMs,
      },
    };
  } catch (error) {
    console.error("❌ Smart intent router fallback failed", error);
    return null;
  }
}

async function buildSalesResultForDirectReply(input: {
  userMessage: string;
  productContext: ProductContext;
  options?: GenerateAgentOptions;
}): Promise<AgentResult | null> {
  if (!shouldBuildDirectReplyWithSalesVoice(input.userMessage)) {
    return null;
  }

  try {
    const { intentAnalysis, meta: routerMeta } = await analyzeAIIntentWithMeta({
      message: input.userMessage,
      productContext: input.productContext,
    });

    if (
      intentAnalysis.intent === "order_start" ||
      intentAnalysis.intent === "order_followup" ||
      intentAnalysis.intent === "unknown"
    ) {
      return null;
    }

    if (canSellerBrainHandle(intentAnalysis)) {
      const recentReplyKeys = await getSellerBrainRecentReplyKeys(input.options);
      const sellerBrainResponse = buildSellerBrainResponse({
        message: input.userMessage,
        customerId: input.options?.customerId,
        productContext: input.productContext,
        intentAnalysis,
        recentReplyKeys,
      });
      const updatedRecentReplyKeys = await saveSellerBrainReplyMemory({
        options: input.options,
        replyKey: sellerBrainResponse.replyKey,
        intent: intentAnalysis.intent,
        fallbackRecentReplyKeys: recentReplyKeys,
      });

      return {
        reply: cleanAgentReply(sellerBrainResponse.reply),
        actions: [],
        source: "seller_brain",
        meta: {
          sellerBrainReplyKey: sellerBrainResponse.replyKey,
          sellerBrainRecentReplyKeys: updatedRecentReplyKeys,
          intentRouterUsedAI: routerMeta.usedAI,
          intentRouterTimedOut: routerMeta.timedOut,
          intentRouterDurationMs: routerMeta.durationMs,
        },
      };
    }

    const salesResponse = buildSalesResponse({
      message: input.userMessage,
      productContext: input.productContext,
      analysis: intentAnalysis,
      customerId: input.options?.customerId,
    });
    const deterministicReply = cleanAgentReply(salesResponse.reply);
    const naturalReply = await generateNaturalReply({
      message: input.userMessage,
      productContext: input.productContext,
      intentAnalysis,
      deterministicReply,
    });

    return {
      reply: cleanAgentReply(naturalReply.reply),
      actions: salesResponse.actions,
      source: "ai_router",
      meta: {
        ...naturalReply.meta,
        intentRouterUsedAI: routerMeta.usedAI,
        intentRouterTimedOut: routerMeta.timedOut,
        intentRouterDurationMs: routerMeta.durationMs,
      },
    };
  } catch (error) {
    console.error("❌ Sales voice direct reply failed", error);
    return null;
  }
}

async function buildAgentResult(
  userMessage: string,
  productContext: ProductContext,
  options?: GenerateAgentOptions,
): Promise<AgentResult> {
  if (shouldUseSmartRouterBeforeDirect(userMessage)) {
    const routerReply = await buildSmartRouterResult(
      userMessage,
      productContext,
      options,
    );

    if (routerReply) {
      return routerReply;
    }
  }

  const directReply = getDirectAgentReply(userMessage, productContext);

  if (directReply) {
    const smartOrderResult = await buildSmartOrderResultIfLikely(
      userMessage,
      productContext,
      options,
    );

    if (smartOrderResult) {
      return smartOrderResult;
    }

    const salesVoiceReply = await buildSalesResultForDirectReply({
      userMessage,
      productContext,
      options,
    });

    if (salesVoiceReply) {
      return salesVoiceReply;
    }

    return {
      reply: cleanAgentReply(directReply.reply),
      actions: directReply.actions ?? [],
      source: "direct",
    };
  }

  const routerReply = await buildSmartRouterResult(
    userMessage,
    productContext,
    options,
  );

  if (routerReply) {
    return routerReply;
  }

  return {
    reply: SAFE_ROUTER_FALLBACK_REPLY,
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
      customerPhone: options.customerPhone,
      sellerId: options.sellerId,
      productId: options.productId,
      message: userMessage,
      productContext,
    });

    if (!orderResult.handled || !orderResult.reply) {
      return null;
    }

    return {
      reply: orderResult.reply,
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
  const startedAt = Date.now();
  const userMessage = message.trim();
  const normalized = normalizeAgentOptions(options);
  const activeOptions = normalized.options;

  if (!userMessage) {
    throw new Error("Message is required");
  }

  await appendMessageToMemory(activeOptions, "customer", userMessage);

  const result =
    (await buildOrderResultIfHandled(userMessage, productContext, activeOptions)) ||
    (await buildAgentResult(userMessage, productContext, activeOptions));

  const orderStateSummary = await getOrderStateSummary(activeOptions);
  const naturalReplyStatus = getNaturalReplyStatus();
  const actions = withChoiceListActions({
    result,
    userMessage,
    productContext,
    orderStateSummary,
  });
  const choiceListAction = actions.find(
    (action) => action.type === "choice_list",
  );
  const reply =
    choiceListAction?.type === "choice_list" &&
    choiceListAction.context === "change_size"
      ? choiceListAction.body
      : result.reply;
  const finalResult: AgentResult = {
    ...result,
    reply,
    actions,
    meta: {
      naturalReplyEnabled: naturalReplyStatus.enabled,
      naturalReplyUsed: false,
      naturalReplyTimedOut: false,
      naturalReplyCircuitOpen: false,
      ...result.meta,
      durationMs: Date.now() - startedAt,
      source: result.source,
      orderStateSummary,
      identity: normalized.identity,
    },
  };

  await appendMessageToMemory(activeOptions, "agent", finalResult.reply);

  return finalResult;
}

export async function generateAgentReply(
  message: string,
  productContext: ProductContext = DEFAULT_PRODUCT_CONTEXT,
  options?: GenerateAgentOptions,
): Promise<string> {
  const result = await generateAgentResult(message, productContext, options);

  return result.reply;
}
