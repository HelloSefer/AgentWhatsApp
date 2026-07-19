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
import { env } from "../../config/env";
import { interactiveSendDecisionService } from "./reply/interactive-send-decision.service";
import type { InteractiveSendChannel } from "./reply/interactive-send-decision.types";
import { whatsappInteractiveMapper } from "./reply/whatsapp-interactive.mapper";
import { productContextService } from "./config/product-context.service";
import { requiredFieldsService } from "./config/required-fields.service";
import type { RequiredOrderField } from "./config/required-fields.types";
import { sellerConfigService } from "./config/seller-config.service";
import type { SellerConfig } from "./config/seller-config.types";
import { buildSalesResponse } from "./sales/sales-response.builder";
import {
  buildSellerBrainResponse,
  canSellerBrainHandle,
} from "./seller-brain/seller-brain-response.service";
import {
  appendConversationMessage,
  appendSellerBrainReplyKey,
  clearConversationProductInfoSelection,
  getConversationSession,
  updateConversationProductInfoState,
} from "./session/conversation-session.service";
import type { AgentIdentity } from "./identity/agent-identity.types";
import { conversationKeyService } from "./identity/conversation-key.service";
import { DEFAULT_DEMO_SELLER_ID } from "./identity/seller-resolver.service";
import type {
  AgentAction,
  AgentOrderStateSummary,
  AgentResult,
} from "./agent-action.types";
import {
  getInfoSelectionFromMessage,
  isProductInfoContinueOrder,
  matchAvailableInfoColor,
  matchAvailableInfoSize,
  normalizeInfoOrderMessage,
  resolveProductInfoRequest,
} from "./info/product-info.service";
import { buildProductInfoReply } from "./info/product-info-response.builder";
import {
  answerInformationalQuestion,
  isInformationalAIEligible,
} from "./info/informational-ai-answer.service";
import type { InformationalAIAnswerDependencies } from "./info/informational-ai-answer.types";
import type { ProductContext } from "./product-context.types";
import { buildOptionalFieldPrompt } from "./order-understanding/optional-field-dialogue.service";
import { renderOrderProgressReply } from "./order/order-response.builder";
import {
  classifyOrderMessageDisposition,
  isSideQuestionDisposition,
} from "./order-understanding/message-disposition.service";
import { processGuardedOrderRuntimeTurn } from "./order/runtime/order-runtime-router.service";

export type GenerateAgentOptions = {
  customerId?: string;
  customerPhone?: string;
  conversationKey?: string;
  sellerId?: string;
  productId?: string;
  phoneNumberId?: string;
  useMemory?: boolean;
  interactiveSendChannel?: InteractiveSendChannel;
  interactiveEnabledOverride?: boolean;
  /** Guarded API/runtime validation only; never set by normal transport paths. */
  orderRuntimeEnabled?: boolean;
};

export type GenerateAgentDependencies = {
  informationalAI?: InformationalAIAnswerDependencies;
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

function getRuntimeRequiredOrderFields(
  options?: GenerateAgentOptions,
): RequiredOrderField[] | undefined {
  if (!options?.sellerId) {
    return undefined;
  }

  try {
    const sellerConfig = sellerConfigService.getSellerConfig(options.sellerId);
    const configProductContext = productContextService.getActiveProductContext(
      options.sellerId,
    );

    return requiredFieldsService.getOrderFields({
      sellerConfig,
      productContext: configProductContext,
    });
  } catch (error) {
    console.error("❌ Required order fields resolution failed", error);
    return undefined;
  }
}

function getRuntimeInteractiveEnabled(options?: GenerateAgentOptions): boolean {
  if (typeof options?.interactiveEnabledOverride === "boolean") {
    return options.interactiveEnabledOverride;
  }

  if (options?.interactiveSendChannel === "whatsapp_cloud") {
    return (
      env.whatsappInteractiveEnabled ||
      (env.whatsappCloudReplyButtonsEnabled &&
        env.whatsappInteractiveChoicesEnabled)
    );
  }

  return env.whatsappInteractiveEnabled;
}

function getRuntimeInfoMenuDisplayMode(
  options?: GenerateAgentOptions,
): SellerConfig["interactive"]["infoMenuDisplayMode"] {
  if (!options?.sellerId) {
    return "list";
  }

  try {
    return sellerConfigService.getSellerConfig(options.sellerId).interactive
      .infoMenuDisplayMode;
  } catch (error) {
    console.error("❌ Info menu display mode resolution failed", error);
    return "list";
  }
}

function withColorArticle(color: string): string {
  return color.startsWith("ال") ? color : `ال${color}`;
}

function buildSoftInfoSelectionResult(input: {
  field: "size" | "color";
  value: string;
  textMode?: boolean;
}): AgentResult {
  const selectionText =
    input.field === "size"
      ? `المقاس ${input.value} متوفر ✅`
      : `اللون ${withColorArticle(input.value)} متوفر ✅`;
  const fieldLabel = input.field === "size" ? "المقاس" : "اللون";
  const body = `${selectionText}\n\nبغيتي نكمل لك الطلب بهذا ${fieldLabel}، ولا تشوف معلومات أخرى؟`;
  const fallback = `${body}\n\nكتب "نكمل الطلب" باش نكملو الطلب، أو "معلومات أخرى" باش تشوف معلومات أخرى.`;

  return {
    reply: input.textMode ? fallback : body,
    actions: [],
    source: "direct",
    meta: {
      replyUi: input.textMode
        ? { kind: "none", purpose: "info_menu" }
        : {
            kind: "buttons",
            purpose: "info_menu",
            body,
            options: [
              {
                id: "info:continue_order",
                label: "نكمل الطلب",
                value: "نكمل الطلب",
              },
              {
                id: "info:menu",
                label: "معلومات أخرى",
                value: "معلومات أخرى",
              },
            ],
          },
    },
  };
}

async function saveSoftInfoPreference(input: {
  options?: GenerateAgentOptions;
  field: "size" | "color";
  value: string;
}): Promise<void> {
  if (!input.options?.useMemory || !input.options.customerId) {
    return;
  }

  const session = await getConversationSession(
    input.options.customerId,
    input.options.sellerId,
    input.options.productId,
    input.options.customerPhone,
  );

  const hasHardOrderFlow = Boolean(
    session.orderState.orderCycleId ||
      session.orderState.confirmed ||
      session.orderState.awaitingConfirmation ||
      session.orderState.missingFields.length > 0 ||
      Object.keys(session.orderState.collected).length > 0,
  );

  if (hasHardOrderFlow) {
    return;
  }

  await updateConversationProductInfoState({
    customerId: input.options.customerId,
    customerPhone: input.options.customerPhone,
    conversationKey: input.options.conversationKey,
    sellerId: input.options.sellerId,
    productId: input.options.productId,
    pendingOrderSelections: {
      [input.field]: input.value,
    },
  });
}

async function updateProductInfoMarker(input: {
  options?: GenerateAgentOptions;
  topic?: "menu" | "price" | "sizes" | "colors" | "delivery_payment" | "availability" | "how_to_order";
  pendingSelection?: "size" | "color";
}): Promise<void> {
  if (!input.options?.useMemory || !input.options.customerId || !input.topic) {
    return;
  }

  await updateConversationProductInfoState({
    customerId: input.options.customerId,
    customerPhone: input.options.customerPhone,
    conversationKey: input.options.conversationKey,
    sellerId: input.options.sellerId,
    productId: input.options.productId,
    lastTopic: input.topic,
    pendingSelection: input.pendingSelection,
  });
}

async function clearProductInfoPendingSelection(
  options?: GenerateAgentOptions,
): Promise<void> {
  if (!options?.useMemory || !options.customerId) {
    return;
  }

  await clearConversationProductInfoSelection({
    customerId: options.customerId,
    customerPhone: options.customerPhone,
    conversationKey: options.conversationKey,
    sellerId: options.sellerId,
    productId: options.productId,
  });
}

async function buildSoftInfoSelectionResultIfHandled(input: {
  userMessage: string;
  productContext: ProductContext;
  options?: GenerateAgentOptions;
  infoMenuDisplayMode: SellerConfig["interactive"]["infoMenuDisplayMode"];
}): Promise<AgentResult | null> {
  if (!input.options?.useMemory || !input.options.customerId) {
    return null;
  }

  const session = await getConversationSession(
    input.options.customerId,
    input.options.sellerId,
    input.options.productId,
    input.options.customerPhone,
  );
  const pendingSelection = session.productInfo?.pendingSelection;
  const hasHardOrderFlow =
    session.orderState.confirmed ||
    session.orderState.awaitingConfirmation ||
    session.orderState.missingFields.length > 0;

  if (!pendingSelection || hasHardOrderFlow) {
    return null;
  }

  const selection = getInfoSelectionFromMessage(
    input.userMessage,
    input.productContext,
  );

  if (!selection || selection.field !== pendingSelection) {
    return null;
  }

  await saveSoftInfoPreference({
    options: input.options,
    field: selection.field,
    value: selection.value,
  });
  await clearProductInfoPendingSelection(input.options);

  return buildSoftInfoSelectionResult({
    field: selection.field,
    value: selection.value,
    textMode: input.infoMenuDisplayMode === "text",
  });
}

function toAgentProductContext(input: {
  sellerConfig: SellerConfig;
  configProductContext: ReturnType<typeof productContextService.getActiveProductContext>;
}): ProductContext {
  const colorGroup = input.configProductContext.optionGroups.find(
    (group) => group.key === "color",
  );
  const sizeGroup = input.configProductContext.optionGroups.find(
    (group) => group.key === "size",
  );

  return {
    businessName: input.sellerConfig.businessName,
    productId: input.configProductContext.productId,
    productName: input.configProductContext.name,
    description: input.configProductContext.description,
    price: String(input.configProductContext.price),
    currency:
      input.configProductContext.currency === "MAD"
        ? "درهم"
        : input.configProductContext.currency,
    availableColors: colorGroup?.options,
    availableSizes: sizeGroup?.options,
    deliveryInfo: input.sellerConfig.delivery.text || undefined,
    deliveryPrice:
      input.sellerConfig.deliveryPolicy.deliveryPrice ??
      input.sellerConfig.delivery.deliveryPrice,
    deliveryIsFree:
      input.sellerConfig.deliveryPolicy.isFree === true ||
      input.sellerConfig.delivery.free === true,
    deliveryPricing: input.sellerConfig.deliveryPolicy.pricing,
    paymentMethods: input.sellerConfig.delivery.paymentText
      ? [input.sellerConfig.delivery.paymentText]
      : undefined,
    offer: input.configProductContext.stock.text,
    stockInfo:
      input.configProductContext.stock.status === "OUT_OF_STOCK"
        ? input.configProductContext.stock.text || "المنتج غير متوفر حالياً"
        : input.configProductContext.stock.status === "LIMITED"
          ? `المنتج متوفر حالياً${
              input.configProductContext.stock.text
                ? `. ${input.configProductContext.stock.text}`
                : " بكمية محدودة"
            }`
          : input.configProductContext.stock.text || "المنتج متوفر حالياً",
    recommendationNotes: input.configProductContext.benefits,
    images: input.configProductContext.images.map((url) => ({ url })),
    requiredOrderFields: [
      ...input.configProductContext.optionGroups
        .filter((group) => group.required)
        .map((group) => group.label),
      ...input.sellerConfig.customerFields
        .filter((field) => field.required && field.enabled)
        .sort((left, right) => (left.askOrder || 0) - (right.askOrder || 0))
        .map((field) => field.label),
    ],
    attributes: {},
    faqs: [],
    unavailableProducts: [],
    extraNotes: [],
  };
}

function resolveRuntimeProductContext(
  productContext: ProductContext,
  options?: GenerateAgentOptions,
): ProductContext {
  if (!options?.sellerId || productContext !== DEFAULT_PRODUCT_CONTEXT) {
    return productContext;
  }

  try {
    const sellerConfig = sellerConfigService.getSellerConfig(options.sellerId);
    const configProductContext = productContextService.getActiveProductContext(
      options.sellerId,
    );

    return toAgentProductContext({
      sellerConfig,
      configProductContext,
    });
  } catch (error) {
    console.error("❌ Runtime product context resolution failed", error);
    return productContext;
  }
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

function mustKeepRouterDeterministic(message: string): boolean {
  const disposition = classifyOrderMessageDisposition(message).disposition;

  return (
    [
      "NEW_ORDER",
      "CONFIRM",
      "EDIT",
      "CANCEL",
      "FIELD_INFORMATION",
      "FIELD_CORRECTION",
    ].includes(disposition) ||
    mightBeOrderMessage(message) ||
    /^(?:first_entry:|field:|edit:|order:|confirm:|info:|size:|color:)/i.test(message.trim())
  );
}

async function buildInformationalAIResult(input: {
  userMessage: string;
  productContext: ProductContext;
  directAnswerGrounded?: boolean;
  dependencies?: GenerateAgentDependencies;
}): Promise<AgentResult | null> {
  const eligible =
    !mustKeepRouterDeterministic(input.userMessage) &&
    isInformationalAIEligible(input.userMessage, {
      directAnswerGrounded: input.directAnswerGrounded,
    });

  if (!eligible) {
    return null;
  }

  const informational = await answerInformationalQuestion(
    {
      message: input.userMessage,
      productContext: input.productContext,
      eligible: true,
    },
    input.dependencies?.informationalAI,
  );

  return {
    reply: cleanAgentReply(informational.reply),
    actions: [],
    source: "ai_fallback",
    meta: {
      informationalAIEligible: true,
      informationalAIUsed: informational.meta.usedAI,
      informationalAITimedOut: informational.meta.timedOut,
      informationalAIValidationFailed: informational.meta.validationFailed,
      informationalAICannotAnswer: informational.meta.cannotAnswer,
      informationalAIDurationMs: informational.meta.durationMs,
      informationalAISkippedReason: informational.meta.skippedReason,
      stateChangedFieldKeys: [],
    },
  };
}

function isExplicitOrderStartRequest(message: string): boolean {
  const hasWantCue = includesAny(message, [
    "بغيت",
    "باغي",
    "باغية",
    "عافاك",
    "bghit",
    "brayt",
    " بغيت ",
  ]);
  const hasOrderCue = includesAny(message, [
    "نكوموندي",
    "نكومندي",
    "نكوماند",
    "نكوموند",
    "كومند",
    "كوموند",
    "كوموندي",
    "الطلب",
    "commande",
    "commander",
    "order",
    "ncommande",
    "ncommandi",
    "ncommander",
    "nkomandi",
  ]);

  return hasWantCue && hasOrderCue || includesAny(message, [
    "بغيت نكوموندي",
    "بغيت نكومندي",
    "بغيت نكوماند",
    "بغيت نكوموند",
    "بغيت كوموند",
    "بغيت الطلب",
    "دير ليا الطلب",
    "وجد ليا الطلب",
    "صوب ليا الطلب",
    "صايب ليا الطلب",
    "تصوب لي كومند",
    "تصوب لي كوموند",
    "تقدر تصوب لي كومند ديالي",
    "واش تقدر تصوب لي كومند ديالي",
    "اك تقد تصوب لي كومند ديالي",
    "اقدر تصوب لي كومند ديالي",
    "bghit ncommande",
    "bghit ncommandi",
    "bghit ncommander",
    "bghit nkomandi",
    "bghit commande",
    "bghit order",
    "dir lia commande",
    "dir lia order",
    "t9dr tsawb lia commande",
    "tsawb lia commande dyali",
  ]);
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
  requiredFields?: RequiredOrderField[],
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
      orderCycleId: session.orderState.orderCycleId,
      isComplete: session.orderState.isComplete,
      awaitingConfirmation: session.orderState.awaitingConfirmation,
      confirmed: session.orderState.confirmed,
      deliveryQuote: session.orderState.deliveryQuote,
      missingFields: session.orderState.missingFields,
      requiredFields: requiredFields?.map((field) => field.key),
      requiredFieldKeys: requiredFields?.map((field) => field.key),
      collected: session.orderState.collected,
      optionalFieldDialogue: session.orderState.optionalFieldDialogue,
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
  requiredFields?: RequiredOrderField[];
}): Promise<AgentResult> {
  if (input.options?.useMemory && input.options.customerId) {
    const orderResult = await processOrderTurn({
      customerId: input.options.customerId,
      customerPhone: input.options.customerPhone,
      sellerId: input.options.sellerId,
      productId: input.options.productId,
      message: input.userMessage,
      productContext: input.productContext,
      requiredFields: input.requiredFields,
      analysis: {
        intent: input.analysis.intent,
      },
    });

    if (orderResult.handled && orderResult.reply) {
      return {
        reply: orderResult.reply,
        actions: [],
        source: "ai_router",
        meta: {
          replyUi: orderResult.replyUi,
          orderConfirmationPresentation: orderResult.replyPresentation,
          orderJustConfirmed: orderResult.orderJustConfirmed,
          receiptRetryRequested: orderResult.receiptRetryRequested,
          confirmedOrderId: orderResult.confirmedOrderId,
          publicOrderCode: orderResult.publicOrderCode,
        },
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
  requiredFields?: RequiredOrderField[],
): Promise<AgentResult | null> {
  if (!options?.useMemory || !options.customerId || !mightBeOrderMessage(userMessage)) {
    return null;
  }

  try {
    const { intentAnalysis, meta: routerMeta } = await analyzeAIIntentWithMeta({
      message: userMessage,
      productContext,
      aiMode: "disabled",
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
      requiredFields,
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
  requiredFields?: RequiredOrderField[],
  aiMode: "informational_only" | "disabled" = "informational_only",
): Promise<AgentResult | null> {
  try {
    const { intentAnalysis, meta: routerMeta } = await analyzeAIIntentWithMeta({
      message: userMessage,
      productContext,
      aiMode,
    });

    if (
      intentAnalysis.intent === "order_start" ||
      intentAnalysis.intent === "order_followup"
    ) {
      if (routerMeta.usedAI) {
        console.warn(JSON.stringify({
          event: "agent.ai_order_lifecycle_blocked",
          intent: intentAnalysis.intent,
        }));
        return null;
      }

      const orderResult = await buildOrderResultFromRouter({
        userMessage,
        productContext,
        options,
        analysis: intentAnalysis,
        requiredFields,
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
      aiMode: "disabled",
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
  requiredFields?: RequiredOrderField[],
  dependencies?: GenerateAgentDependencies,
): Promise<AgentResult> {
  const directReply = getDirectAgentReply(userMessage, productContext);

  if (
    shouldUseSmartRouterBeforeDirect(userMessage) &&
    directReply?.grounded !== true
  ) {
    const routerReply = await buildSmartRouterResult(
      userMessage,
      productContext,
      options,
      requiredFields,
      "disabled",
    );

    if (routerReply) {
      return routerReply;
    }
  }

  if (directReply) {
    const informationalReply = await buildInformationalAIResult({
      userMessage,
      productContext,
      directAnswerGrounded: directReply.grounded,
      dependencies,
    });

    if (informationalReply) {
      return informationalReply;
    }

    const smartOrderResult = await buildSmartOrderResultIfLikely(
      userMessage,
      productContext,
      options,
      requiredFields,
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

  const informationalReply = await buildInformationalAIResult({
    userMessage,
    productContext,
    dependencies,
  });

  if (informationalReply) {
    return informationalReply;
  }

  const routerReply = await buildSmartRouterResult(
    userMessage,
    productContext,
    options,
    requiredFields,
    "disabled",
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
  requiredFields?: RequiredOrderField[],
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
      requiredFields,
    });

    if (!orderResult.handled || !orderResult.reply) {
      return null;
    }

    return {
      reply: orderResult.reply,
      actions: [],
      source: "direct",
      meta: {
        replyUi: orderResult.replyUi,
        orderConfirmationPresentation: orderResult.replyPresentation,
        orderJustConfirmed: orderResult.orderJustConfirmed,
        receiptRetryRequested: orderResult.receiptRetryRequested,
        confirmedOrderId: orderResult.confirmedOrderId,
        publicOrderCode: orderResult.publicOrderCode,
      },
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
  dependencies: GenerateAgentDependencies = {},
): Promise<AgentResult> {
  const startedAt = Date.now();
  const userMessage = message.trim();
  const normalized = normalizeAgentOptions(options);
  const activeOptions = normalized.options;
  const runtimeProductContext = resolveRuntimeProductContext(
    productContext,
    activeOptions,
  );
  const requiredFields = getRuntimeRequiredOrderFields(activeOptions);
  const infoMenuDisplayMode = getRuntimeInfoMenuDisplayMode(activeOptions);

  if (!userMessage) {
    throw new Error("Message is required");
  }

  // Phase 6.3 runtime is an opt-in seller-scoped boundary. A disabled seller
  // deliberately continues through the legacy conversation path below.
  if (activeOptions?.useMemory && normalized.identity) {
    try {
      const runtimeResult = await processGuardedOrderRuntimeTurn({
        sellerId: normalized.identity.sellerId,
        customerPhone: normalized.identity.customerPhone,
        conversationKey: normalized.identity.conversationKey,
        productId: activeOptions.productId,
        message: userMessage,
        activationRequested: activeOptions.orderRuntimeEnabled === true,
      });
      if (runtimeResult.handled && runtimeResult.reply) {
        const naturalReplyStatus = getNaturalReplyStatus();
        const whatsappInteractivePreview = whatsappInteractiveMapper.toCloudInteractivePreview({
          replyText: runtimeResult.reply,
          replyUi: runtimeResult.replyUi,
        });
        const interactiveSendDecision = interactiveSendDecisionService.decide({
          channel: activeOptions.interactiveSendChannel || "test",
          interactiveEnabled: getRuntimeInteractiveEnabled(activeOptions),
          whatsappInteractivePreview,
        });
        return {
          reply: runtimeResult.reply,
          actions: [],
          source: "direct",
          meta: {
            durationMs: Date.now() - startedAt,
            source: "direct",
            naturalReplyEnabled: naturalReplyStatus.enabled,
            naturalReplyUsed: false,
            naturalReplyTimedOut: false,
            naturalReplyCircuitOpen: false,
            aiUsed: false,
            identity: normalized.identity,
            replyUi: runtimeResult.replyUi,
            whatsappInteractivePreview,
            interactiveSendDecision,
            orderRuntime: {
              stage: runtimeResult.stage || "RECOVERY_REQUIRED",
              confirmedSnapshotId: runtimeResult.confirmedSnapshotId,
              receiptReady: runtimeResult.receiptReady,
            },
          },
        };
      }
    } catch (error) {
      // The guarded runtime must not take down the legacy agent path.
      console.error("❌ Guarded order runtime failed", error);
    }
  }

  await appendMessageToMemory(activeOptions, "customer", userMessage);

  const productInfoRequest = resolveProductInfoRequest(userMessage);
  const orderDisposition = classifyOrderMessageDisposition(userMessage);
  const orderRoutingMessage = orderDisposition.disposition === "NEW_ORDER"
    ? userMessage
    : isExplicitOrderStartRequest(userMessage)
      ? "first_entry:order_now"
      : normalizeInfoOrderMessage(userMessage);

  if (isProductInfoContinueOrder(userMessage)) {
    await clearProductInfoPendingSelection(activeOptions);
  }

  const softInfoSelectionResult = await buildSoftInfoSelectionResultIfHandled({
    userMessage,
    productContext: runtimeProductContext,
    options: activeOptions,
    infoMenuDisplayMode,
  });
  const orderStateFirstResult = softInfoSelectionResult
    ? null
    : await buildOrderResultIfHandled(
        orderRoutingMessage,
        runtimeProductContext,
        activeOptions,
        requiredFields,
      );

  const productInfoReply =
    !orderStateFirstResult &&
    !softInfoSelectionResult &&
    productInfoRequest &&
    productInfoRequest.topic !== "order_now"
      ? buildProductInfoReply({
          message: userMessage,
          request: productInfoRequest,
          productContext: runtimeProductContext,
          requiredFields,
          infoMenuDisplayMode,
        })
      : undefined;

  if (
    !orderStateFirstResult &&
    productInfoRequest &&
    productInfoRequest.topic !== "order_now"
  ) {
    const selectedSize = matchAvailableInfoSize(
      productInfoRequest.requestedSize,
      runtimeProductContext,
    );
    const selectedColor = matchAvailableInfoColor(
      productInfoRequest.requestedColor,
      runtimeProductContext,
    );

    if (selectedSize) {
      await saveSoftInfoPreference({
        options: activeOptions,
        field: "size",
        value: selectedSize,
      });
    } else if (selectedColor) {
      await saveSoftInfoPreference({
        options: activeOptions,
        field: "color",
        value: selectedColor,
      });
    }

    await updateProductInfoMarker({
      options: activeOptions,
      topic: productInfoRequest.topic,
      pendingSelection:
        productInfoRequest.topic === "sizes" && !selectedSize
          ? "size"
          : productInfoRequest.topic === "colors" && !selectedColor
            ? "color"
            : undefined,
    });
  }

  const result =
    orderStateFirstResult ||
    softInfoSelectionResult ||
    (productInfoReply
      ? {
          reply: productInfoReply.text,
          actions: [],
          source: "direct" as const,
          meta: { replyUi: productInfoReply.ui },
        }
      : (await buildAgentResult(
          orderRoutingMessage,
          runtimeProductContext,
          activeOptions,
          requiredFields,
          dependencies,
        )));

  const orderStateSummary = await getOrderStateSummary(activeOptions, requiredFields);
  const naturalReplyStatus = getNaturalReplyStatus();
  const actions = withChoiceListActions({
    result,
    userMessage,
    productContext: runtimeProductContext,
    orderStateSummary,
  });
  const choiceListAction = actions.find(
    (action) => action.type === "choice_list",
  );
  const baseReply =
    choiceListAction?.type === "choice_list" &&
    choiceListAction.context === "change_size"
      ? choiceListAction.body
      : result.reply;
  const awaitedField =
    orderStateSummary?.missingFields?.[0] ||
    orderStateSummary?.optionalFieldDialogue?.activeOptionalFieldKey;
  const activeOptionalField = requiredFields?.find(
    (field) =>
      field.key === orderStateSummary?.optionalFieldDialogue?.activeOptionalFieldKey,
  );
  const optionalResumePrompt = activeOptionalField
    ? buildOptionalFieldPrompt(activeOptionalField)
    : undefined;
  const requiredResumePrompt =
    awaitedField &&
    !activeOptionalField &&
    orderStateSummary?.collected
      ? renderOrderProgressReply({
          collected: orderStateSummary.collected,
          missingFields: orderStateSummary.missingFields,
          isComplete: false,
          productContext: runtimeProductContext,
          requiredFields,
        })
      : undefined;
  const shouldResumeOrderAfterSideQuestion =
    !orderStateFirstResult &&
    Boolean(awaitedField) &&
    (
      isSideQuestionDisposition(orderDisposition.disposition) ||
      result.meta?.informationalAIEligible === true ||
      /[؟?]/.test(userMessage) ||
      Boolean(optionalResumePrompt)
    );
  const resumeLabel = requiredFields?.find((field) => field.key === awaitedField)?.label || awaitedField;
  const reply = shouldResumeOrderAfterSideQuestion
    ? `${baseReply}\n\n${optionalResumePrompt?.text || requiredResumePrompt?.text || `وبالنسبة للطلب ديالك، عافاك صيفط ليا ${resumeLabel}.`}`
    : baseReply;
  const replyUi = optionalResumePrompt?.ui || requiredResumePrompt?.ui || result.meta?.replyUi;
  const whatsappInteractivePreview =
    whatsappInteractiveMapper.toCloudInteractivePreview({
      replyText: reply,
      replyUi,
    });
  const interactiveSendDecision = interactiveSendDecisionService.decide({
    channel: activeOptions?.interactiveSendChannel || "test",
    interactiveEnabled: getRuntimeInteractiveEnabled(activeOptions),
    whatsappInteractivePreview,
  });
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
      aiUsed: Boolean(
        result.meta?.informationalAIUsed ||
          result.meta?.intentRouterUsedAI ||
          result.meta?.naturalReplyUsed,
      ),
      stateChangedFieldKeys:
        result.meta?.stateChangedFieldKeys ||
        (shouldResumeOrderAfterSideQuestion ? [] : undefined),
      durationMs: Date.now() - startedAt,
      source: result.source,
      orderStateSummary,
      identity: normalized.identity,
      whatsappInteractivePreview,
      interactiveSendDecision,
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
