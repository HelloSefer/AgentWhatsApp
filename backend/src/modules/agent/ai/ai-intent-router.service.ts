import { generateStructuredAIReply } from "../../ai/ai.service";
import { env } from "../../../config/env";
import type {
  ConversationOrderState,
  ConversationSession,
} from "../agent-brain.types";
import {
  safeFallbackIntentAnalysis,
  validateAIIntentRouterAnalysis,
} from "./ai-intent-router.schema";
import { DEFAULT_PRODUCT_CONTEXT } from "../default-product-context";
import type { ProductContext } from "../product-context.types";

export const aiIntentRouterIntents = [
  "greeting",
  "price_question",
  "size_question",
  "color_question",
  "delivery_question",
  "payment_question",
  "image_request",
  "product_info_question",
  "order_start",
  "order_followup",
  "order_confirmation",
  "order_correction",
  "objection_price",
  "objection_delivery",
  "objection_trust",
  "negotiation",
  "complaint",
  "unrelated",
  "unknown",
] as const;

export const aiIntentRouterLanguages = [
  "darija",
  "arabic",
  "arabizi",
  "french",
  "english",
  "mixed",
  "unknown",
] as const;

export const aiIntentRouterCustomerMoods = [
  "interested",
  "ready_to_order",
  "hesitant",
  "confused",
  "price_sensitive",
  "angry",
  "neutral",
] as const;

export const aiIntentRouterSalesStages = [
  "new_lead",
  "asking_info",
  "comparing",
  "ready_to_order",
  "giving_order_info",
  "awaiting_confirmation",
  "confirmed",
  "not_relevant",
] as const;

export type AIIntentRouterIntent = (typeof aiIntentRouterIntents)[number];
export type AIIntentRouterLanguage = (typeof aiIntentRouterLanguages)[number];
export type AIIntentRouterCustomerMood =
  (typeof aiIntentRouterCustomerMoods)[number];
export type AIIntentRouterSalesStage =
  (typeof aiIntentRouterSalesStages)[number];

export interface AIIntentRouterEntities {
  size: string | null;
  color: string | null;
  city: string | null;
  quantity: number | null;
  phone: string | null;
  fullName: string | null;
  address: string | null;
}

export interface AIIntentRouterAnalysis {
  intent: AIIntentRouterIntent;
  subIntent: string | null;
  entities: AIIntentRouterEntities;
  language: AIIntentRouterLanguage;
  customerMood: AIIntentRouterCustomerMood;
  salesStage: AIIntentRouterSalesStage;
  salesOpportunity: boolean;
  shouldUseDirectAnswer: boolean;
  shouldContinueOrderFlow: boolean;
  confidence: number;
}

export interface AIIntentRouterMeta {
  durationMs: number;
  preExtractDurationMs: number;
  aiDurationMs: number;
  parseDurationMs: number;
  usedAI: boolean;
  timedOut: boolean;
  validationFailed: boolean;
  model: string;
}

export interface AIIntentRouterResult {
  intentAnalysis: AIIntentRouterAnalysis;
  meta: AIIntentRouterMeta;
}

type AnalyzeAIIntentInput = {
  message: string;
  productContext?: ProductContext;
  sessionContext?: ConversationSession;
  orderState?: ConversationOrderState;
};

type DeterministicPreExtraction = {
  entities: Partial<AIIntentRouterEntities>;
  hasExplicitNumericSize: boolean;
};

const AI_INTENT_ROUTER_TIMEOUT_MS = 3500;

const directAnswerIntents: AIIntentRouterIntent[] = [
  "price_question",
  "size_question",
  "color_question",
  "delivery_question",
  "payment_question",
  "image_request",
  "product_info_question",
];

const orderFlowIntents: AIIntentRouterIntent[] = [
  "order_start",
  "order_followup",
  "order_confirmation",
  "order_correction",
];

const fallbackAnalysis: AIIntentRouterAnalysis = safeFallbackIntentAnalysis;

const aiIntentRouterSchema = {
  type: "object",
  properties: {
    intent: { type: "string", enum: aiIntentRouterIntents },
    subIntent: { type: ["string", "null"] },
    entities: {
      type: "object",
      properties: {
        size: { type: ["string", "null"] },
        color: { type: ["string", "null"] },
        city: { type: ["string", "null"] },
        quantity: { type: ["number", "null"] },
        phone: { type: ["string", "null"] },
        fullName: { type: ["string", "null"] },
        address: { type: ["string", "null"] },
      },
      required: [
        "size",
        "color",
        "city",
        "quantity",
        "phone",
        "fullName",
        "address",
      ],
      additionalProperties: false,
    },
    language: { type: "string", enum: aiIntentRouterLanguages },
    customerMood: { type: "string", enum: aiIntentRouterCustomerMoods },
    salesStage: { type: "string", enum: aiIntentRouterSalesStages },
    salesOpportunity: { type: "boolean" },
    shouldUseDirectAnswer: { type: "boolean" },
    shouldContinueOrderFlow: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "intent",
    "subIntent",
    "entities",
    "language",
    "customerMood",
    "salesStage",
    "salesOpportunity",
    "shouldUseDirectAnswer",
    "shouldContinueOrderFlow",
    "confidence",
  ],
  additionalProperties: false,
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(message: string, keywords: string[]): boolean {
  const normalizedMessage = normalizeText(message);

  return keywords.some((keyword) =>
    normalizedMessage.includes(normalizeText(keyword)),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed || null;
}

function sanitizeQuantity(value: unknown): number | null {
  const quantity = typeof value === "number" ? value : Number(value);

  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function clampConfidence(value: unknown): number {
  const confidence = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(confidence)) {
    return 0;
  }

  return Math.max(0, Math.min(1, confidence));
}

function sanitizeEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowedValues.includes(value as T)
    ? (value as T)
    : fallback;
}

function sanitizeEntities(value: unknown): AIIntentRouterEntities {
  if (!isObject(value)) {
    return { ...fallbackAnalysis.entities };
  }

  return {
    size: sanitizeString(value.size),
    color: sanitizeString(value.color),
    city: sanitizeString(value.city),
    quantity: sanitizeQuantity(value.quantity),
    phone: sanitizeString(value.phone),
    fullName: sanitizeString(value.fullName),
    address: sanitizeString(value.address),
  };
}

function sanitizeAnalysis(value: unknown): AIIntentRouterAnalysis {
  if (!isObject(value)) {
    return fallbackAnalysis;
  }

  return {
    intent: sanitizeEnum(value.intent, aiIntentRouterIntents, "unknown"),
    subIntent: sanitizeString(value.subIntent),
    entities: sanitizeEntities(value.entities),
    language: sanitizeEnum(value.language, aiIntentRouterLanguages, "unknown"),
    customerMood: sanitizeEnum(
      value.customerMood,
      aiIntentRouterCustomerMoods,
      "neutral",
    ),
    salesStage: sanitizeEnum(
      value.salesStage,
      aiIntentRouterSalesStages,
      "not_relevant",
    ),
    salesOpportunity:
      typeof value.salesOpportunity === "boolean"
        ? value.salesOpportunity
        : false,
    shouldUseDirectAnswer:
      typeof value.shouldUseDirectAnswer === "boolean"
        ? value.shouldUseDirectAnswer
        : false,
    shouldContinueOrderFlow:
      typeof value.shouldContinueOrderFlow === "boolean"
        ? value.shouldContinueOrderFlow
        : false,
    confidence: clampConfidence(value.confidence),
  };
}

function extractFirstJsonObject(text: string): string | null {
  const startIndex = text.indexOf("{");

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (character === "\\") {
      isEscaped = true;
      continue;
    }

    if (character === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      depth += 1;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseRouterJson(text: string): unknown {
  const jsonText = extractFirstJsonObject(text);

  if (!jsonText) {
    throw new Error("No JSON object found");
  }

  return JSON.parse(jsonText);
}

function compactProductContext(productContext: ProductContext): Record<string, unknown> {
  return {
    businessName: productContext.businessName,
    productName: productContext.productName,
    category: productContext.category,
    price: productContext.price,
    currency: productContext.currency,
    availableColors: productContext.availableColors,
    availableSizes: productContext.availableSizes,
    variants: productContext.variants,
    deliveryInfo: productContext.deliveryInfo,
    deliveryAreas: productContext.deliveryAreas,
    deliveryTime: productContext.deliveryTime,
    paymentMethods: productContext.paymentMethods,
    offer: productContext.offer,
    requiredOrderFields: productContext.requiredOrderFields,
  };
}

function compactSessionContext(
  sessionContext?: ConversationSession,
  orderState?: ConversationOrderState,
): Record<string, unknown> {
  return {
    recentMessages: sessionContext?.messages.slice(-8),
    orderState: orderState || sessionContext?.orderState || null,
  };
}

function buildAIIntentRouterPrompt(input: {
  message: string;
  productContext: ProductContext;
  sessionContext?: ConversationSession;
  orderState?: ConversationOrderState;
}): string {
  return `
You are a JSON-only AI intent router for a Moroccan WhatsApp sales agent.
Analyze the customer message. Do not write the final customer reply.
Return one valid JSON object only, with no markdown and no explanation.

Languages to understand: Moroccan Darija, Arabic, Arabizi, French, English, and mixed messages.
Do not invent product facts. Do not save orders. Do not trigger notifications.

Supported intents:
${aiIntentRouterIntents.join(", ")}

Supported languages:
${aiIntentRouterLanguages.join(", ")}

Supported customerMood:
${aiIntentRouterCustomerMoods.join(", ")}

Supported salesStage:
${aiIntentRouterSalesStages.join(", ")}

Rules:
- If current orderState is incomplete, set shouldContinueOrderFlow true.
- If current orderState.awaitingConfirmation is true, classify confirmation/correction before product questions.
- If current orderState.confirmed is true, salesStage must be confirmed.
- Clear product fact questions can set shouldUseDirectAnswer true.
- Flexible, mixed, unclear, objection, negotiation, trust, and order messages shouldUseDirectAnswer false.
- If customer asks to buy/order, use order_start.
- If customer gives missing order info during active flow, use order_followup.
- If customer says yes/ok/confirm after summary, use order_confirmation.
- If customer wants to change order info, use order_correction.
- If customer asks COD/payment on delivery, use payment_question.
- If customer asks delivery timing/availability, use delivery_question.
- If customer distrusts seller or asks if this is scam, use objection_trust.
- If customer says expensive or asks for lower price, use objection_price or negotiation.
- If unsure, use unknown with confidence below 0.5.

Entity rules:
- Extract only values present in the customer message.
- Use null for missing entity fields.
- quantity must be a number or null.
- Preserve explicit numeric sizes exactly. Never convert 36, 37, 38, 39, 40, 41, 42, 43, 44, or 45 to S/M/L/XL.
- Keep customer-provided city spelling when clear, for example "casa" stays "casa".

Examples:
Message: "salam bghit ncommande wa7da 38 f casa"
JSON: {"intent":"order_start","subIntent":"provide_order_info","entities":{"size":"38","color":null,"city":"casa","quantity":1,"phone":null,"fullName":null,"address":null},"language":"arabizi","customerMood":"ready_to_order","salesStage":"ready_to_order","salesOpportunity":true,"shouldUseDirectAnswer":false,"shouldContinueOrderFlow":true,"confidence":0.91}

Message: "wach taman akhor? ghali chwiya"
JSON: {"intent":"objection_price","subIntent":"price_negotiation","entities":{"size":null,"color":null,"city":null,"quantity":null,"phone":null,"fullName":null,"address":null},"language":"arabizi","customerMood":"price_sensitive","salesStage":"comparing","salesOpportunity":true,"shouldUseDirectAnswer":false,"shouldContinueOrderFlow":false,"confidence":0.9}

Message: "kifach n3rfkom mashi nasaba?"
JSON: {"intent":"objection_trust","subIntent":"trust_concern","entities":{"size":null,"color":null,"city":null,"quantity":null,"phone":null,"fullName":null,"address":null},"language":"arabizi","customerMood":"hesitant","salesStage":"comparing","salesOpportunity":true,"shouldUseDirectAnswer":false,"shouldContinueOrderFlow":false,"confidence":0.9}

Message: "send me pictures"
JSON: {"intent":"image_request","subIntent":"request_product_images","entities":{"size":null,"color":null,"city":null,"quantity":null,"phone":null,"fullName":null,"address":null},"language":"english","customerMood":"interested","salesStage":"asking_info","salesOpportunity":true,"shouldUseDirectAnswer":true,"shouldContinueOrderFlow":false,"confidence":0.9}

Message: "بغيت نبدل المقاس 39"
JSON: {"intent":"order_correction","subIntent":"change_size","entities":{"size":"39","color":null,"city":null,"quantity":null,"phone":null,"fullName":null,"address":null},"language":"darija","customerMood":"interested","salesStage":"awaiting_confirmation","salesOpportunity":true,"shouldUseDirectAnswer":false,"shouldContinueOrderFlow":true,"confidence":0.9}

Message: "كاين الدفع عند الاستلام؟"
JSON: {"intent":"payment_question","subIntent":"cash_on_delivery","entities":{"size":null,"color":null,"city":null,"quantity":null,"phone":null,"fullName":null,"address":null},"language":"darija","customerMood":"interested","salesStage":"asking_info","salesOpportunity":true,"shouldUseDirectAnswer":true,"shouldContinueOrderFlow":false,"confidence":0.9}

Product context:
${JSON.stringify(compactProductContext(input.productContext))}

Session context:
${JSON.stringify(compactSessionContext(input.sessionContext, input.orderState))}

Customer message:
${JSON.stringify(input.message)}

Output JSON shape:
{"intent":"unknown","subIntent":null,"entities":{"size":null,"color":null,"city":null,"quantity":null,"phone":null,"fullName":null,"address":null},"language":"unknown","customerMood":"neutral","salesStage":"not_relevant","salesOpportunity":false,"shouldUseDirectAnswer":false,"shouldContinueOrderFlow":false,"confidence":0}
`.trim();
}

function detectLanguage(message: string): AIIntentRouterLanguage {
  const hasArabic = /[\u0600-\u06ff]/.test(message);
  const hasLatin = /[a-z]/i.test(message);

  if (hasArabic && hasLatin) {
    return "mixed";
  }

  if (hasArabic) {
    if (
      includesAny(message, [
        "واش",
        "شنو",
        "اش",
        "بغيت",
        "ديال",
        "كاين",
        "فين",
        "عافاك",
        "جوج",
        "سميتي",
        "خلي",
        "بدل",
        "غلط",
      ])
    ) {
      return "darija";
    }

    return includesAny(message, ["هل", "متى", "ثمن"]) ? "arabic" : "darija";
  }

  if (hasLatin) {
    if (["hello", "hi", "hey"].includes(normalizeText(message))) {
      return "english";
    }

    if (includesAny(message, ["merci", "bonjour", "bonsoir"])) {
      return "french";
    }

    if (includesAny(message, ["send", "pictures", "price", "confirm"])) {
      return "english";
    }

    if (includesAny(message, ["livraison", "prix", "taille"])) {
      return "french";
    }

    return "arabizi";
  }

  return "unknown";
}

function findExplicitNumericSize(message: string): string | null {
  const match = message.match(/\b(3[6-9]|4[0-5])\b/);

  return match?.[1] || null;
}

function findLabeledLetterSize(message: string): string | null {
  const match = message.match(
    /(?:size|taille|مقاس|قياس)\s*(xxl|xl|xs|s|m|l)\b/i,
  );

  return match?.[1]?.toUpperCase() || null;
}

function findSize(message: string): string | null {
  return findExplicitNumericSize(message) || findLabeledLetterSize(message);
}

function hasQuestionCue(message: string): boolean {
  return (
    /[؟?]/.test(message) ||
    includesAny(message, [
      "واش",
      "شنو",
      "اش",
      "اشنو",
      "آش",
      "هل",
      "فين",
      "كيفاش",
      "wach",
      "chno",
      "shno",
      "xno",
      "what",
      "how",
      "where",
      "ina",
      "ach men",
    ])
  );
}

function isAddressContext(message: string): boolean {
  return includesAny(message, [
    "العنوان",
    "عنوان",
    "عنواني",
    "حي",
    "زنقة",
    "شارع",
    "رقم",
    "دوار",
    "address",
    "adresse",
  ]);
}

function findQuantity(message: string, explicitSize?: string | null): number | null {
  const normalizedMessage = normalizeText(message);
  const labeledQuantity = normalizedMessage.match(
    /(?:quantity|qty|quantite|كمية|الكمية|عدد)\s*(?:هو|هي|:)?\s*(?:ل)?([1-9]|1[0-9]|20)\b/,
  );

  if (labeledQuantity) {
    return Number(labeledQuantity[1]);
  }

  if (
    includesAny(message, [
      "wa7da",
      "wahda",
      "w7da",
      "wahed",
      "wahd",
      "waheda",
      "واحدة",
      "وحدة",
      "واحد",
    ])
  ) {
    return 1;
  }

  if (
    includesAny(message, ["jooj", "jouj", "jوج", "جوج", "زوج"])
  ) {
    return 2;
  }

  const numericOnly = normalizedMessage.match(/^([1-9]|1[0-9]|20)$/);

  if (numericOnly && numericOnly[1] !== explicitSize) {
    return Number(numericOnly[1]);
  }

  const pieceQuantity = normalizedMessage.match(
    /\b([1-9]|1[0-9]|20)\s*(?:ديال|pcs|pieces|piece|وحدات|قطع)\b/,
  );

  if (pieceQuantity && pieceQuantity[1] !== explicitSize) {
    return Number(pieceQuantity[1]);
  }

  if (isAddressContext(message)) {
    return null;
  }

  const explicitQuantity = Array.from(
    normalizedMessage.matchAll(/\b([1-9]|1[0-9]|20)\b/g),
  )
    .map((match) => Number(match[1]))
    .find((quantity) => String(quantity) !== explicitSize);

  if (explicitQuantity) {
    return explicitQuantity;
  }

  return null;
}

function findPhone(message: string): string | null {
  const phone = message.match(/(?:\+212|0)[67]\d{8}\b/)?.[0];

  if (!phone) {
    return null;
  }

  return phone.startsWith("+212") ? `0${phone.slice(4)}` : phone;
}

function findCity(message: string): string | null {
  const normalizedMessage = normalizeText(message);
  const aliases = [
    { match: "casa", value: "casa" },
    { match: "casablanca", value: "casablanca" },
    { match: "كازا", value: "كازا" },
    { match: "الدار البيضاء", value: "الدار البيضاء" },
    { match: "للدار البيضاء", value: "الدار البيضاء" },
    { match: "دار البيضاء", value: "الدار البيضاء" },
    { match: "marrakech", value: "marrakech" },
    { match: "marrakesh", value: "marrakech" },
    { match: "مراكش", value: "مراكش" },
    { match: "rabat", value: "rabat" },
    { match: "rbat", value: "rabat" },
    { match: "الرباط", value: "الرباط" },
    { match: "fes", value: "fes" },
    { match: "fès", value: "fes" },
    { match: "فاس", value: "فاس" },
    { match: "tanger", value: "tanger" },
    { match: "tangier", value: "tangier" },
    { match: "tanja", value: "tanja" },
    { match: "طنجة", value: "طنجة" },
  ];

  return (
    aliases.find((alias) =>
      normalizedMessage.includes(normalizeText(alias.match)),
    )?.value || null
  );
}

function findColor(message: string): string | null {
  const comparable = normalizeText(message)
    .replace(/للدار البيضاء/g, "")
    .replace(/الدار البيضاء/g, "")
    .replace(/دار البيضاء/g, "")
    .replace(/casablanca/g, "");
  const hasColor = (keywords: string[]) =>
    keywords.some((keyword) => comparable.includes(normalizeText(keyword)));

  if (hasColor(["ابيض", "بيضاء", "الابيض", "white", "blanc"])) {
    return "أبيض";
  }

  if (
    hasColor([
      "اسود",
      "سوداء",
      "كحل",
      "كحلة",
      "k7al",
      "k7la",
      "black",
      "noir",
    ])
  ) {
    return "أسود";
  }

  if (hasColor(["وردي", "الوردي", "rose", "pink"])) {
    return "وردي";
  }

  if (hasColor(["اصفر", "صفر", "الاصفر", "sfar", "yellow", "jaune"])) {
    return "أصفر";
  }

  return null;
}

function cleanExtractedText(value: string): string | null {
  const cleaned = value
    .replace(/[،,.;:!?؟]+$/g, "")
    .replace(/^(هو|هي|:|-)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function findFullName(message: string): string | null {
  const labelMatch = message.match(/(?:سميتي|اسمي|الاسم|سمية|name)\s*(?:ديالي)?\s*(?:هو|هي|:)?\s*/i);

  if (!labelMatch || labelMatch.index === undefined) {
    return null;
  }

  const afterLabel = message.slice(labelMatch.index + labelMatch[0].length);
  const beforePhone = afterLabel.split(/(?:\+212|0)[67]\d{8}\b/)[0];
  const beforeNextField = beforePhone.split(
    /\s+(?:الهاتف|تلفون|telephone|phone|العنوان|عنوان|المدينة|city|address|adresse)\s*/i,
  )[0];
  const cleaned = cleanExtractedText(beforeNextField);

  if (!cleaned) {
    return null;
  }

  return cleaned.split(/\s+/).slice(0, 4).join(" ");
}

function findAddress(message: string, phone?: string | null): string | null {
  const labeledAddress = message.match(/(?:العنوان|عنواني|address|adresse)\s*(?:هو|هي|:)?\s*(.+)$/i);

  if (labeledAddress?.[1]) {
    return cleanExtractedText(labeledAddress[1]);
  }

  if (phone) {
    const phoneIndex = message.indexOf(phone);
    const afterPhone =
      phoneIndex >= 0 ? message.slice(phoneIndex + phone.length) : "";
    const cleaned = cleanExtractedText(afterPhone);

    if (cleaned) {
      return cleaned;
    }
  }

  const addressLike = message.match(/(?:^|\s)((?:حي|زنقة|شارع|دوار|hay)\s+.+)$/i);

  return addressLike?.[1] ? cleanExtractedText(addressLike[1]) : null;
}

function preExtractDeterministicEntities(
  message: string,
): DeterministicPreExtraction {
  const explicitNumericSize = findExplicitNumericSize(message);
  const phone = findPhone(message);

  return {
    entities: {
      size: findSize(message),
      city: findCity(message),
      quantity: findQuantity(message, explicitNumericSize),
      phone,
      color: findColor(message),
      fullName: findFullName(message),
      address: findAddress(message, phone),
    },
    hasExplicitNumericSize: Boolean(explicitNumericSize),
  };
}

function hasAnyEntity(entities: Partial<AIIntentRouterEntities>): boolean {
  return Boolean(
    entities.size ||
      entities.color ||
      entities.city ||
      entities.quantity ||
      entities.phone ||
      entities.fullName ||
      entities.address,
  );
}

function getPresentEntities(
  entities?: Partial<AIIntentRouterEntities>,
): Partial<AIIntentRouterEntities> {
  if (!entities) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(entities).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<AIIntentRouterEntities>;
}

function hasOrderStartCue(message: string): boolean {
  return includesAny(message, [
    "bghit",
    "بغيت",
    "nakhod",
    "nakhoud",
    "nakhd",
    "nakhod lia",
    "nakhoud lia",
    "ncommande",
    "ncommandi",
    "ncommander",
    "نكوموندي",
    "نكومندي",
    "نطلب",
    "طلب",
    "الطلب",
    "بغيت الطلب",
    "دير ليا الطلب",
    "وجد ليا الطلب",
    "صوب ليا الطلب",
    "صايب ليا الطلب",
    "كومند",
    "كوموند",
    "كوموندي",
    "بغيت كوموند",
    "بغيت نكوموند",
    "تصوب لي كومند",
    "تصوب لي كوموند",
    "تقدر تصوب لي كومند ديالي",
    "واش تقدر تصوب لي كومند ديالي",
    "اك تقد تصوب لي كومند ديالي",
    "اقدر تصوب لي كومند ديالي",
    "commande",
    "order",
    "bghit commande",
    "bghit order",
    "dir lia commande",
    "dir lia order",
    "t9dr tsawb lia commande",
    "tsawb lia commande dyali",
    "khoud lia",
    "khod lia",
    "khoud liya",
    "خود ليا",
    "خذ ليا",
    "عافاك بغيت",
  ]);
}

function isDomainOrderStartRequest(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  if (
    ["الطلب", "طلب", "commande", "order", "كومند", "كوموند"].includes(
      normalizedMessage,
    )
  ) {
    return true;
  }

  return includesAny(message, [
    "بغيت نكوموندي",
    "بغيت نكومندي",
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
    "bghit ncommandi",
    "bghit ncommander",
    "bghit commande",
    "bghit order",
    "dir lia commande",
    "dir lia order",
    "t9dr tsawb lia commande",
    "tsawb lia commande dyali",
  ]);
}

function hasOrderCorrectionCue(message: string): boolean {
  return includesAny(message, [
    "نبدل",
    "بدل",
    "بغيت نبدل",
    "غلط",
    "خلي",
    "change",
    "modifier",
  ]);
}

function hasOrderFollowupCue(message: string): boolean {
  return includesAny(message, [
    "سميتي",
    "اسمي",
    "الاسم",
    "الهاتف",
    "تلفون",
    "phone",
    "telephone",
    "المدينة",
    "city",
    "العنوان",
    "عنوان",
    "address",
    "adresse",
    "اللون",
    "color",
    "couleur",
    "الكمية",
    "كمية",
    "quantity",
    "qty",
    "pointure",
  ]);
}

function isNeutralAcknowledgement(message: string): boolean {
  return [
    "hmm",
    "hm",
    "ok",
    "okay",
    "daccord",
    "d'accord",
    "merci",
    "thanks",
    "شكرا",
  ].some((value) => normalizeText(message) === normalizeText(value));
}

function isLowSignalUnknown(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return (
    /^[؟?!.،,\s]+$/.test(message) ||
    normalizedMessage.length <= 2 ||
    ["???", "??", "...", ".."].includes(normalizedMessage)
  );
}

function isPersonaQuestion(message: string): boolean {
  return includesAny(message, [
    "شنو سميتك",
    "شنو سميتك؟",
    "اش سميتك",
    "اشنو سميتك",
    "سميتك",
    "smitk",
    "smitik",
    "smiya",
    "who are you",
    "who r u",
    "nta bot",
    "nti bot",
    "wach bot",
    "واش بوت",
    "واش روبو",
    "واش إنسان",
    "واش انسان",
    "are you human",
    "human",
    "bot",
  ]);
}

function getPersonaSubIntent(message: string): string {
  return includesAny(message, [
    "واش إنسان",
    "واش انسان",
    "are you human",
    "human",
    "bot",
    "nta bot",
    "nti bot",
    "wach bot",
    "واش بوت",
    "واش روبو",
  ])
    ? "human_check"
    : "assistant_identity";
}

function isProductOverviewQuestion(message: string): boolean {
  return includesAny(message, [
    "شنو هو المنتوج",
    "شنو المنتوج",
    "شنو المنتج",
    "شنو السلعة",
    "شنو كتبيعو",
    "شنو كتبيع",
    "اش كتبيعو",
    "شنو عندكم",
    "شنو كاين عندكم",
    "what do you sell",
    "what are you selling",
    "what product",
    "chno katbi3o",
    "xno katbi3o",
    "ach katbi3o",
    "chno 3andkom",
    "xno 3andkom",
  ]);
}

function isColorQuestionLike(
  message: string,
  entities: Partial<AIIntentRouterEntities>,
  hasQuestion: boolean,
): boolean {
  return (
    !hasOrderCorrectionCue(message) &&
    (Boolean(entities.color) &&
      (hasQuestion ||
        includesAny(message, [
          "kayn",
          "كاين",
          "available",
          "متوفر",
          "متوفرة",
          "لون",
          "lon",
          "color",
          "couleur",
          "brayt",
          "bghit",
          "بغيت",
        ]))) ||
    (includesAny(message, [
      "الوان",
      "الألوان",
      "الالوان",
      "alwan",
      "alwan kaynin",
      "لون",
      "lon",
      "color",
      "colors",
      "couleur",
      "couleurs",
      "ach men color",
      "chno alwan",
      "ina alwan",
    ]) &&
      (hasQuestion || includesAny(message, ["kaynin", "kayn", "كاينين", "كاين"])))
  );
}

function isOffTopicSmallTalk(message: string): boolean {
  return includesAny(message, [
    "الماتش",
    "ماتش",
    "match",
    "football",
    "الطقس",
    "weather",
    "سياسة",
    "politics",
  ]);
}

function inferDeterministicHints(message: string): Partial<AIIntentRouterAnalysis> {
  const language = detectLanguage(message);
  const preExtracted = preExtractDeterministicEntities(message);
  const entities: Partial<AIIntentRouterEntities> = {
    ...preExtracted.entities,
  };
  const hasQuestion = hasQuestionCue(message);

  if (isLowSignalUnknown(message)) {
    return {
      intent: "unknown",
      subIntent: "low_signal",
      language,
      customerMood: "neutral",
      salesStage: "not_relevant",
      salesOpportunity: false,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (isNeutralAcknowledgement(message)) {
    return {
      intent: includesAny(message, ["merci"]) ? "greeting" : "unknown",
      subIntent: includesAny(message, ["merci", "thanks", "شكرا"])
        ? "acknowledgement"
        : null,
      language,
      customerMood: "neutral",
      salesStage: "not_relevant",
      salesOpportunity: false,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (isOffTopicSmallTalk(message)) {
    return {
      intent: "unknown",
      subIntent: "off_topic",
      language,
      customerMood: "neutral",
      salesStage: "not_relevant",
      salesOpportunity: false,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (isPersonaQuestion(message)) {
    return {
      intent: "product_info_question",
      subIntent: getPersonaSubIntent(message),
      language,
      customerMood: "neutral",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: false,
      confidence: 0.93,
    };
  }

  if (isProductOverviewQuestion(message)) {
    return {
      intent: "product_info_question",
      subIntent: "product_overview",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: false,
      confidence: 0.93,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    includesAny(message, [
      "اللون لي خارج",
      "لون خارج",
      "خارج اكثر",
      "خارج كثر",
      "الأكثر طلبا",
      "الاكثر طلبا",
      "اكثر طلب",
      "popular color",
      "best color",
      "top color",
    ])
  ) {
    return {
      intent: "product_info_question",
      subIntent: "popular_color",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: false,
      confidence: 0.93,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (isColorQuestionLike(message, entities, hasQuestion)) {
    return {
      intent: "color_question",
      subIntent: entities.color ? "specific_color" : "available_colors",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.92,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    hasOrderCorrectionCue(message) &&
    (hasAnyEntity(entities) ||
      includesAny(message, [
        "المقاس",
        "size",
        "taille",
        "المدينة",
        "الهاتف",
        "اللون",
        "الكمية",
        "العنوان",
      ]))
  ) {
    const subIntent = entities.size
      ? "change_size"
      : entities.color
        ? "change_color"
        : entities.city
          ? "change_city"
          : entities.phone
            ? "change_phone"
            : entities.quantity
              ? "change_quantity"
              : entities.address
                ? "change_address"
                : "order_correction";

    return {
      intent: "order_correction",
      subIntent,
      language,
      customerMood: "interested",
      salesStage: "awaiting_confirmation",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: true,
      confidence: 0.92,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (isDomainOrderStartRequest(message)) {
    return {
      intent: "order_start",
      subIntent: "start_order",
      language,
      customerMood: "ready_to_order",
      salesStage: "ready_to_order",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: true,
      confidence: 0.93,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    hasOrderStartCue(message) &&
    (entities.size || entities.city || entities.quantity || entities.color)
  ) {
    return {
      intent: "order_start",
      subIntent: "provide_order_info",
      language,
      customerMood: "ready_to_order",
      salesStage: "ready_to_order",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: true,
      confidence: 0.92,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    includesAny(message, [
      "nasaba",
      "نصابة",
      "نصاب",
      "mashi nasaba",
      "ثقة",
      "نضمن",
      "ضمان",
      "مضمون",
      "اراء",
      "آراء",
      "راء ديال الزبناء",
      "reviews",
      "avis",
    ])
  ) {
    return {
      intent: "objection_trust",
      subIntent: includesAny(message, ["اراء", "آراء", "reviews", "avis"])
        ? "social_proof_request"
        : "trust_concern",
      language,
      customerMood: "hesitant",
      salesStage: "comparing",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (
    includesAny(message, [
      "ghali",
      "غالي",
      "taman akhor",
      "akher taman",
      "ثمن اخر",
      "تمن اخر",
      "اخر ثمن",
      "آخر ثمن",
      "نقص",
      "rkhssa",
      "rkhis",
      "رخيصة",
      "رخيص",
      "رخص",
      "ناقصة",
      "ناقص",
      "b7alha",
      "بحالها",
      "بلاصة اخرى",
      "بلاصة أخري",
      "اخرى",
    ])
  ) {
    const isComparison = includesAny(message, [
      "rkhssa",
      "rkhis",
      "رخيصة",
      "رخيص",
      "رخص",
      "ناقصة",
      "ناقص",
      "b7alha",
      "بحالها",
      "بلاصة اخرى",
      "بلاصة أخري",
      "اخرى",
    ]);

    return {
      intent: includesAny(message, [
        "taman akhor",
        "akher taman",
        "ثمن اخر",
        "تمن اخر",
        "اخر ثمن",
        "آخر ثمن",
        "نقص",
        "ناقصة",
        "ناقص",
        "rkhssa",
        "rkhis",
        "رخيصة",
        "رخيص",
        "رخص",
        "b7alha",
        "بحالها",
      ])
        ? "negotiation"
        : "objection_price",
      subIntent: isComparison ? "price_comparison" : "price_negotiation",
      language,
      customerMood: "price_sensitive",
      salesStage: "comparing",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (
    includesAny(message, [
      "شنو كتنصحني",
      "اش تنصحني",
      "كتنصحني",
      "تنصحني",
      "محتارة",
      "محتار",
      "شنو ناخد",
      "شنو نختار",
      "مناسبة",
      "للخروج",
      "الخروج",
      "l khroj",
      "lkhroj",
      "khroj",
      "lkhrij",
      "رجل شوية عريضة",
      "رجل عريضة",
      "wide foot",
      "مريحة",
      "مريح",
      "كتجي مريحة",
      "confort",
      "comfortable",
      "recommend",
      "advice",
    ])
  ) {
    const subIntent = includesAny(message, [
      "رجل شوية عريضة",
      "رجل عريضة",
      "wide foot",
    ])
      ? "size_recommendation"
      : includesAny(message, [
            "مناسبة",
            "للخروج",
            "الخروج",
            "l khroj",
            "lkhroj",
            "khroj",
            "lkhrij",
            "usage",
            "use",
          ])
        ? "usage_question"
        : includesAny(message, [
              "مريحة",
              "مريح",
              "كتجي مريحة",
              "confort",
              "comfortable",
            ])
          ? "comfort_question"
          : "recommendation_request";

    return {
      intent: "product_info_question",
      subIntent,
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    includesAny(message, [
      "فين المحل",
      "المحل",
      "فين كاينين",
      "فين نقدر نشوفها",
      "نقدر نشوفها",
      "نشوفها",
      "nchofha",
      "adresse magasin",
      "store location",
    ])
  ) {
    return {
      intent: "product_info_question",
      subIntent: "store_location",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (includesAny(message, ["send me pictures", "pictures", "photos", "تصاور", "الصور", "tsawr"])) {
    return {
      intent: "image_request",
      subIntent: "request_product_images",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (
    entities.color &&
    (hasQuestion ||
      includesAny(message, ["kayn", "كاين", "available", "متوفر", "متوفرة"]))
  ) {
    return {
      intent: "color_question",
      subIntent: "specific_color",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    includesAny(message, [
      "الوان",
      "الألوان",
      "الالوان",
      "لون",
      "colors",
      "couleurs",
    ]) &&
    hasQuestion
  ) {
    return {
      intent: "color_question",
      subIntent: "available_colors",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    (includesAny(message, [
      "مقاس",
      "المقاسات",
      "قياس",
      "القياسات",
      "سايز",
      "السايزات",
      "size",
      "sizes",
      "taille",
      "pointure",
      "pointures",
    ]) &&
      hasQuestion) ||
    (entities.size && includesAny(message, ["واش كاين", "kayn", "available"]))
  ) {
    return {
      intent: "size_question",
      subIntent: entities.size ? "specific_size" : "available_sizes",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    includesAny(message, [
      "شحال",
      "الثمن",
      "التمن",
      "ثمن",
      "تمن",
      "price",
      "prix",
      "taman",
      "bach7l",
      "bachhal",
      "bach7al",
      "bach7l hadi",
      "bachhal hadi",
      "bch7l",
      "bch7l hadi",
      "chhal",
      "ch7al",
      "ch7al hadi",
      "bch7al",
      "b ch7al",
      "bchhal",
      "bch7alhadi",
      "بشحال",
      "شحال هادي",
    ])
    && !includesAny(message, [
      "التوصيل",
      "توصيل",
      "livraison",
      "delivery",
    ])
  ) {
    return {
      intent: "price_question",
      subIntent: "product_price",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (
    includesAny(message, [
      "الدفع عند الاستلام",
      "الدفع",
      "نخلص",
      "خلص",
      "cash on delivery",
      "pay",
      "paiement",
    ])
  ) {
    return {
      intent: "payment_question",
      subIntent: "cash_on_delivery",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (
    includesAny(message, [
      "التوصيل",
      "توصيل",
      "توصلي",
      "توصلني",
      "livraison",
      "delivery",
      "مجاني",
    ])
  ) {
    const isDeliveryCost = includesAny(message, [
      "شحال",
      "bch7al",
      "bchhal",
      "cost",
      "fee",
      "ثمن التوصيل",
      "تمن التوصيل",
    ]);

    return {
      intent: "delivery_question",
      subIntent: isDeliveryCost
        ? "delivery_cost"
        : includesAny(message, ["مجاني", "free"])
          ? "delivery_fee"
          : "delivery_info",
      language,
      customerMood: "interested",
      salesStage: "asking_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  if (
    hasOrderFollowupCue(message) ||
    (hasAnyEntity(entities) && !hasQuestion) ||
    ["جوج", "زوج", "wa7da", "wahda", "jouj", "jooj"].some(
      (value) => normalizeText(message) === normalizeText(value),
    )
  ) {
    return {
      intent: "order_followup",
      subIntent: "provide_order_info",
      language,
      customerMood: "ready_to_order",
      salesStage: "giving_order_info",
      salesOpportunity: true,
      shouldUseDirectAnswer: false,
      shouldContinueOrderFlow: true,
      confidence: 0.9,
      entities: {
        ...fallbackAnalysis.entities,
        ...entities,
      },
    };
  }

  if (
    ["hello", "hi", "hey", "salam", "salut", "سلام", "السلام عليكم"].some(
      (value) => normalizeText(message) === normalizeText(value),
    )
  ) {
    return {
      intent: "greeting",
      subIntent: null,
      language,
      customerMood: "neutral",
      salesStage: "new_lead",
      salesOpportunity: true,
      shouldUseDirectAnswer: true,
      shouldContinueOrderFlow: false,
      confidence: 0.9,
    };
  }

  return {};
}

function buildDeterministicAnalysis(
  message: string,
  orderState?: ConversationOrderState,
  preExtraction?: DeterministicPreExtraction,
): AIIntentRouterAnalysis | null {
  const analysis = finalizeAnalysis(
    fallbackAnalysis,
    message,
    orderState,
    preExtraction,
  );

  if (analysis.confidence < 0.9) {
    return null;
  }

  return analysis;
}

function applySessionState(
  analysis: AIIntentRouterAnalysis,
  orderState?: ConversationOrderState,
): AIIntentRouterAnalysis {
  if (!orderState) {
    return analysis;
  }

  if (orderState.confirmed) {
    return {
      ...analysis,
      salesStage: "confirmed",
      shouldContinueOrderFlow: false,
    };
  }

  if (orderState.awaitingConfirmation) {
    return {
      ...analysis,
      salesStage: "awaiting_confirmation",
      shouldContinueOrderFlow: true,
    };
  }

  if (orderState.missingFields.length > 0) {
    return {
      ...analysis,
      salesStage: "giving_order_info",
      shouldContinueOrderFlow: true,
    };
  }

  return analysis;
}

function finalizeAnalysis(
  analysis: AIIntentRouterAnalysis,
  message: string,
  orderState?: ConversationOrderState,
  preExtraction?: DeterministicPreExtraction,
): AIIntentRouterAnalysis {
  const deterministicHints = inferDeterministicHints(message);
  const deterministicEntities = getPresentEntities(preExtraction?.entities);
  const deterministicHintEntities = getPresentEntities(deterministicHints.entities);
  const mergedEntities = {
    ...analysis.entities,
    ...deterministicHintEntities,
    ...deterministicEntities,
  };
  const intent = deterministicHints.intent || analysis.intent;
  const finalAnalysis: AIIntentRouterAnalysis = {
    ...analysis,
    ...deterministicHints,
    intent,
    entities: {
      ...fallbackAnalysis.entities,
      ...mergedEntities,
    },
    shouldUseDirectAnswer: directAnswerIntents.includes(intent)
      ? true
      : deterministicHints.shouldUseDirectAnswer ?? analysis.shouldUseDirectAnswer,
    shouldContinueOrderFlow: orderFlowIntents.includes(intent)
      ? true
      : deterministicHints.shouldContinueOrderFlow ??
        analysis.shouldContinueOrderFlow,
  };

  return applySessionState(finalAnalysis, orderState);
}

function buildMeta(input: {
  totalStartedAt: number;
  preExtractDurationMs: number;
  aiDurationMs: number;
  parseDurationMs: number;
  usedAI: boolean;
  timedOut: boolean;
  validationFailed: boolean;
}): AIIntentRouterMeta {
  return {
    durationMs: Date.now() - input.totalStartedAt,
    preExtractDurationMs: input.preExtractDurationMs,
    aiDurationMs: input.aiDurationMs,
    parseDurationMs: input.parseDurationMs,
    usedAI: input.usedAI,
    timedOut: input.timedOut,
    validationFailed: input.validationFailed,
    model: env.ollamaModel,
  };
}

function logTiming(meta: AIIntentRouterMeta): void {
  console.log(
    `🧭 AI intent router timing total=${meta.durationMs}ms pre=${meta.preExtractDurationMs}ms ai=${meta.aiDurationMs}ms parse=${meta.parseDurationMs}ms usedAI=${meta.usedAI} timedOut=${meta.timedOut} validationFailed=${meta.validationFailed} model=${meta.model}`,
  );
}

export async function analyzeAIIntent(
  input: AnalyzeAIIntentInput,
): Promise<AIIntentRouterAnalysis> {
  const result = await analyzeAIIntentWithMeta(input);

  return result.intentAnalysis;
}

export async function analyzeAIIntentWithMeta(
  input: AnalyzeAIIntentInput,
): Promise<AIIntentRouterResult> {
  const totalStartedAt = Date.now();
  const userMessage = input.message.trim();

  if (!userMessage) {
    throw new Error("Message is required");
  }

  const productContext = input.productContext || DEFAULT_PRODUCT_CONTEXT;
  const orderState = input.orderState || input.sessionContext?.orderState;
  const preExtractStartedAt = Date.now();
  const preExtraction = preExtractDeterministicEntities(userMessage);
  const preExtractDurationMs = Date.now() - preExtractStartedAt;
  let aiDurationMs = 0;
  let parseDurationMs = 0;
  let usedAI = false;
  let timedOut = false;
  let validationFailed = false;
  let intentAnalysis: AIIntentRouterAnalysis;
  let aiStartedAt = 0;

  try {
    const deterministicAnalysis = buildDeterministicAnalysis(
      userMessage,
      orderState,
      preExtraction,
    );

    if (deterministicAnalysis) {
      const validated = validateAIIntentRouterAnalysis(deterministicAnalysis);
      intentAnalysis = validated.analysis;
      validationFailed = validated.validationFailed;

      const meta = buildMeta({
        totalStartedAt,
        preExtractDurationMs,
        aiDurationMs,
        parseDurationMs,
        usedAI,
        timedOut,
        validationFailed,
      });
      logTiming(meta);

      return { intentAnalysis, meta };
    }

    const prompt = buildAIIntentRouterPrompt({
      message: userMessage,
      productContext,
      sessionContext: input.sessionContext,
      orderState,
    });
    usedAI = true;
    aiStartedAt = Date.now();
    const aiReply = await generateStructuredAIReply(
      prompt,
      aiIntentRouterSchema,
      {
        timeoutMs: AI_INTENT_ROUTER_TIMEOUT_MS,
      },
    );
    aiDurationMs = Date.now() - aiStartedAt;

    const parseStartedAt = Date.now();
    const parsed = parseRouterJson(aiReply);
    const sanitizedAnalysis = sanitizeAnalysis(parsed);
    const finalAnalysis = finalizeAnalysis(
      sanitizedAnalysis,
      userMessage,
      orderState,
      preExtraction,
    );
    const validated = validateAIIntentRouterAnalysis(finalAnalysis);
    intentAnalysis = validated.analysis;
    validationFailed = validated.validationFailed;
    parseDurationMs = Date.now() - parseStartedAt;

    const meta = buildMeta({
      totalStartedAt,
      preExtractDurationMs,
      aiDurationMs,
      parseDurationMs,
      usedAI,
      timedOut,
      validationFailed,
    });
    logTiming(meta);

    return { intentAnalysis, meta };
  } catch (error) {
    if (usedAI && aiStartedAt && aiDurationMs === 0) {
      aiDurationMs = Date.now() - aiStartedAt;
    }

    timedOut =
      error instanceof Error &&
      error.message.toLowerCase().includes("timed out");

    const finalAnalysis = finalizeAnalysis(
      fallbackAnalysis,
      userMessage,
      orderState,
      preExtraction,
    );
    const validated = validateAIIntentRouterAnalysis(finalAnalysis);
    intentAnalysis = validated.analysis;
    validationFailed = validated.validationFailed;

    const meta = buildMeta({
      totalStartedAt,
      preExtractDurationMs,
      aiDurationMs,
      parseDurationMs,
      usedAI,
      timedOut,
      validationFailed,
    });
    logTiming(meta);

    return { intentAnalysis, meta };
  }
}
