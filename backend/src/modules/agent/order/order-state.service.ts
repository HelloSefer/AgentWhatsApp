import type { OrderEntities } from "../agent-brain.types";
import { fastAnalyzeCustomerMessage } from "../fast-intent-analyzer.service";
import type { ProductContext } from "../product-context.types";
import {
  getConversationSession,
  updateConversationOrderState,
} from "../session/conversation-session.service";
import { buildOrderProgressReply } from "./order-response.builder";

type OrderField = keyof OrderEntities;

type ProcessOrderTurnInput = {
  customerId: string;
  sellerId?: string;
  productId?: string;
  message: string;
  productContext: ProductContext;
};

type ProcessOrderTurnResult = {
  handled: boolean;
  reply?: string;
  isComplete: boolean;
  missingFields: string[];
};

const defaultRequiredOrderFields: OrderField[] = [
  "fullName",
  "phone",
  "city",
  "address",
];

const fieldLabelMap = new Map<string, OrderField>([
  ["الاسم الكامل", "fullName"],
  ["الإسم الكامل", "fullName"],
  ["الاسم", "fullName"],
  ["رقم الهاتف", "phone"],
  ["الهاتف", "phone"],
  ["المدينة", "city"],
  ["العنوان", "address"],
  ["اللون", "color"],
  ["المقاس", "size"],
  ["الكمية", "quantity"],
  ["productName", "productName"],
  ["variant", "variant"],
]);

const cityAliases: Array<{ city: string; aliases: string[] }> = [
  { city: "مراكش", aliases: ["مراكش", "marrakech", "marrakesh"] },
  { city: "كازا", aliases: ["كازا", "casa", "casablanca", "الدار البيضاء"] },
  { city: "الرباط", aliases: ["الرباط", "rabat"] },
  { city: "فاس", aliases: ["فاس", "fes", "fès"] },
  { city: "طنجة", aliases: ["طنجة", "tanger", "tangier", "tanja"] },
];

const colorAliases: Array<{ color: string; aliases: string[] }> = [
  {
    color: "أسود",
    aliases: ["كحل", "كحلة", "أسود", "اسود", "k7el", "k7la", "kahla", "noir", "black"],
  },
  {
    color: "وردي",
    aliases: ["وردي", "الوردي", "werdi", "wardi", "rose", "lwerdi", "pink"],
  },
  {
    color: "أبيض",
    aliases: ["أبيض", "ابيض", "بيضاء", "byda", "bayda", "white", "blanc"],
  },
  {
    color: "أحمر",
    aliases: ["أحمر", "احمر", "حمر", "حمرة", "7mra", "hamra", "red", "rouge"],
  },
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

function cleanEntities(entities: OrderEntities): Partial<OrderEntities> {
  return Object.fromEntries(
    Object.entries(entities).filter(([, value]) => hasValue(value)),
  ) as Partial<OrderEntities>;
}

function getRequiredOrderFields(productContext: ProductContext): OrderField[] {
  const mappedFields = (productContext.requiredOrderFields || [])
    .map((field) => fieldLabelMap.get(field))
    .filter((field): field is OrderField => Boolean(field));

  return mappedFields.length ? mappedFields : defaultRequiredOrderFields;
}

function computeMissingFields(
  collected: OrderEntities,
  productContext: ProductContext,
): string[] {
  return getRequiredOrderFields(productContext).filter(
    (field) => !hasValue(collected[field]),
  );
}

function findPhone(message: string): string | undefined {
  const phoneMatch = message.match(/(?:\+212|0)[67]\d{8}\b/);
  const phone = phoneMatch?.[0];

  if (!phone) {
    return undefined;
  }

  return phone.startsWith("+212") ? `0${phone.slice(4)}` : phone;
}

function findCity(message: string): string | undefined {
  const normalizedMessage = normalizeText(message);

  return cityAliases.find((cityAlias) =>
    cityAlias.aliases.some((alias) =>
      normalizedMessage.includes(normalizeText(alias)),
    ),
  )?.city;
}

function findColor(message: string): string | undefined {
  const normalizedMessage = normalizeText(message);

  return colorAliases.find((colorAlias) =>
    colorAlias.aliases.some((alias) =>
      normalizedMessage.includes(normalizeText(alias)),
    ),
  )?.color;
}

function findSize(message: string): string | undefined {
  const sizeMatch = message.match(
    /(?:size|taille|مقاس|قياس)?\s*(3[6-9]|4[0-5]|xxl|xl|xs|s|m|l)\b/i,
  );

  return sizeMatch?.[1]?.toUpperCase();
}

function findQuantity(message: string): number | undefined {
  if (/(^|\s)1(\s|$)/.test(message) || /wa7da/i.test(message) || message.includes("واحدة")) {
    return 1;
  }

  if (/(^|\s)2(\s|$)/.test(message) || message.includes("جوج") || message.includes("زوج")) {
    return 2;
  }

  return undefined;
}

function findAddress(message: string): string | undefined {
  const normalizedMessage = normalizeText(message);
  const addressMatch = normalizedMessage.match(/\b(حي|شارع|زنقة|رقم)\s+(.+)/);

  return addressMatch ? `${addressMatch[1]} ${addressMatch[2]}`.trim() : undefined;
}

function getPhoneTextFromMessage(message: string, phone: string): string | undefined {
  if (message.includes(phone)) {
    return phone;
  }

  return message.match(/(?:\+212|0)[67]\d{8}\b/)?.[0];
}

function looksLikeAddressText(text: string): boolean {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return false;
  }

  if (/^(حي|شارع|زنقة|رقم)\b/.test(normalizedText)) {
    return true;
  }

  return normalizedText.split(/\s+/).length >= 2;
}

function findAddressAfterPhone(message: string, phone: string): string | undefined {
  const phoneText = getPhoneTextFromMessage(message, phone);

  if (!phoneText) {
    return undefined;
  }

  const phoneIndex = message.indexOf(phoneText);

  if (phoneIndex < 0) {
    return undefined;
  }

  const addressCandidate = message.slice(phoneIndex + phoneText.length).trim();

  return looksLikeAddressText(addressCandidate)
    ? normalizeText(addressCandidate)
    : undefined;
}

function findNameBeforePhone(message: string, phone: string): string | undefined {
  const phoneText = getPhoneTextFromMessage(message, phone);

  if (!phoneText) {
    return undefined;
  }

  const phoneIndex = message.indexOf(phoneText);

  if (phoneIndex <= 0) {
    return undefined;
  }

  return message.slice(0, phoneIndex).trim().split(/\s+/).slice(0, 3).join(" ");
}

function isSimpleArabicName(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return (
    /^[\u0600-\u06ff\s]{2,30}$/.test(normalizedMessage) &&
    normalizedMessage.split(/\s+/).length <= 3 &&
    !findCity(message) &&
    !findColor(message) &&
    !findAddress(message)
  );
}

function extractStandaloneEntities(
  message: string,
  missingFields: string[],
): Partial<OrderEntities> {
  const entities: Partial<OrderEntities> = {};
  const phone = findPhone(message);

  if (phone && missingFields.includes("phone")) {
    entities.phone = phone;
  }

  if (phone && missingFields.includes("fullName")) {
    entities.fullName = findNameBeforePhone(message, phone);
  }

  if (phone && missingFields.includes("address")) {
    entities.address = findAddressAfterPhone(message, phone);
  }

  if (missingFields.includes("city")) {
    entities.city = findCity(message);
  }

  if (missingFields.includes("size")) {
    entities.size = findSize(message);
  }

  if (missingFields.includes("color")) {
    entities.color = findColor(message);
  }

  if (missingFields.includes("quantity")) {
    entities.quantity = findQuantity(message);
  }

  if (!entities.address && missingFields.includes("address")) {
    entities.address = findAddress(message);
  }

  if (!entities.fullName && missingFields.includes("fullName") && isSimpleArabicName(message)) {
    entities.fullName = normalizeText(message);
  }

  return cleanEntities(entities);
}

function mergeEntities(
  existing: OrderEntities,
  incoming: Partial<OrderEntities>,
): OrderEntities {
  const merged: OrderEntities = { ...existing };

  for (const [key, value] of Object.entries(incoming) as Array<[
    keyof OrderEntities,
    OrderEntities[keyof OrderEntities],
  ]>) {
    if (hasValue(value) && !hasValue(merged[key])) {
      (merged[key] as typeof value) = value;
    }
  }

  return merged;
}

function hasCollectedOrderData(collected: OrderEntities): boolean {
  return Object.values(collected).some((value) => hasValue(value));
}

function shouldTreatAsOrderFlow(input: {
  intent?: string;
  existingCollected: OrderEntities;
  currentMissingFields: string[];
  standaloneEntities: Partial<OrderEntities>;
}): boolean {
  if (input.intent === "order_intent" || input.intent === "order_info_provided") {
    return true;
  }

  if (!hasCollectedOrderData(input.existingCollected)) {
    return false;
  }

  return input.currentMissingFields.length > 0;
}

export async function processOrderTurn(
  input: ProcessOrderTurnInput,
): Promise<ProcessOrderTurnResult> {
  const session = await getConversationSession(
    input.customerId,
    input.sellerId,
    input.productId,
  );
  const analysis = fastAnalyzeCustomerMessage(input.message);
  const currentMissingFields =
    session.orderState.missingFields.length > 0
      ? session.orderState.missingFields
      : computeMissingFields(session.orderState.collected, input.productContext);
  const standaloneEntities = extractStandaloneEntities(
    input.message,
    currentMissingFields,
  );
  const shouldHandle = shouldTreatAsOrderFlow({
    intent: analysis?.intent,
    existingCollected: session.orderState.collected,
    currentMissingFields,
    standaloneEntities,
  });

  if (!shouldHandle) {
    return {
      handled: false,
      isComplete: session.orderState.isComplete,
      missingFields: session.orderState.missingFields,
    };
  }

  const incomingEntities = {
    ...cleanEntities(analysis?.entities || {}),
    ...standaloneEntities,
  };
  const collected = mergeEntities(session.orderState.collected, incomingEntities);
  const missingFields = computeMissingFields(collected, input.productContext);
  const isComplete = missingFields.length === 0;
  const awaitingConfirmation = isComplete;

  await updateConversationOrderState({
    customerId: input.customerId,
    sellerId: input.sellerId,
    productId: input.productId,
    collected,
    missingFields,
    isComplete,
    awaitingConfirmation,
  });

  return {
    handled: true,
    reply: buildOrderProgressReply({
      collected,
      missingFields,
      isComplete,
      productContext: input.productContext,
    }),
    isComplete,
    missingFields,
  };
}
