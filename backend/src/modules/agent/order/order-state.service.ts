import type { ConversationSession, OrderEntities } from "../agent-brain.types";
import { createNewConfirmedOrderNotification } from "../admin/admin-notification.service";
import { fastAnalyzeCustomerMessage } from "../fast-intent-analyzer.service";
import type { ProductContext } from "../product-context.types";
import {
  getInvalidOrderFields,
  isValidOrderField,
  recordInvalidCandidateRejected,
  recordInvalidExistingCleared,
  recordOrderConfirmationBlockedInvalidFields,
  validateOrderEntities,
} from "./order-field-validator.service";
import {
  getConversationSession,
  saveConversationSession,
  updateConversationOrderState,
} from "../session/conversation-session.service";
import { saveConfirmedOrder } from "./confirmed-order-store.service";
import { buildOrderProgressReply } from "./order-response.builder";

type OrderField = keyof OrderEntities;

type ProcessOrderTurnInput = {
  customerId: string;
  sellerId?: string;
  productId?: string;
  message: string;
  productContext: ProductContext;
  analysis?: {
    intent?: string;
    entities?: OrderEntities;
  };
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
  {
    city: "الدار البيضاء",
    aliases: [
      "كازا",
      "casa",
      "casablanca",
      "الدار البيضاء",
      "الدارالبيضاء",
      "دار البيضاء",
      "دارالبيضاء",
    ],
  },
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
  {
    color: "أصفر",
    aliases: ["أصفر", "اصفر", "صفر", "sfar", "yellow", "jaune"],
  },
];

const confirmationMessages = [
  "نعم",
  "اه",
  "واخا",
  "اكد",
  "ناكد",
  "صافي",
  "توكل",
  "توكل على الله",
  "تمام",
  "yes",
  "confirm",
  "ok",
];

const negativeCorrectionMessages = [
  "لا",
  "لا باقي",
  "no",
  "non",
];
const cancellationMessages = [
  "الغاء الطلب",
  "الغاء",
  "إلغاء الطلب",
  "إلغاء",
  "لا شكرا الغي الطلب",
  "لا شكراً الغي الطلب",
  "cancel order",
  "cancel",
];

const correctionKeywords = [
  "بغيت نبدل",
  "باغي نبدل",
  "باغية نبدل",
  "نبدل",
  "غلط",
  "بدل",
  "غير",
  "صحح",
];

const correctionClarificationReply =
  "شنو المعلومة اللي بغيتي تبدل؟ المقاس، اللون، الكمية، الاسم، الهاتف، المدينة ولا العنوان؟";
const alreadyConfirmedReply =
  "الطلب ديالك راه تأكد من قبل. غادي نتواصلو معاك قريباً.";
const orderCancelledReply =
  "تمام، ما غاديش نأكد الطلب. إلى بغيتي تبدل شي حاجة ولا ترجع تطلب، أنا هنا.";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[؟?،,.;:!]/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(normalizedText: string, terms: string[]): boolean {
  return terms.some((term) => normalizedText.includes(normalizeText(term)));
}

function normalizeComparable(text: string): string {
  return normalizeText(text).replace(/^ال/, "");
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

function isExactMessage(normalizedText: string, messages: string[]): boolean {
  return messages.some((message) => normalizedText === normalizeText(message));
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

function getAvailableColors(productContext: ProductContext): string[] {
  return productContext.availableColors?.map((color) => color.trim()).filter(Boolean) || [];
}

function getAvailableSizes(productContext: ProductContext): string[] {
  return productContext.availableSizes?.map((size) => size.trim()).filter(Boolean) || [];
}

function isAvailableColorValue(
  color: string,
  productContext: ProductContext,
): boolean {
  const availableColors = getAvailableColors(productContext);

  if (!availableColors.length) {
    return true;
  }

  return availableColors.some(
    (availableColor) =>
      normalizeComparable(availableColor) === normalizeComparable(color),
  );
}

function isAvailableSizeValue(
  size: string,
  productContext: ProductContext,
): boolean {
  const availableSizes = getAvailableSizes(productContext);

  if (!availableSizes.length) {
    return true;
  }

  return availableSizes.some(
    (availableSize) =>
      normalizeComparable(availableSize) === normalizeComparable(size),
  );
}

function buildUnavailableColorReply(
  color: string,
  productContext: ProductContext,
): string {
  const availableColors = getAvailableColors(productContext);
  const colorText = color.startsWith("ال") ? color : `ال${color}`;

  if (!availableColors.length) {
    return `اللون ${colorText} ما نقدرش نأكدو دابا. نقدر نراجع الألوان المتوفرة من عند صاحب المتجر.`;
  }

  return `اللون ${colorText} ما متوفرش حالياً. الألوان المتوفرة هي: ${formatNaturalList(
    availableColors,
  )}. شنو اللون اللي بغيتي؟`;
}

function buildUnavailableSizeReply(
  size: string,
  productContext: ProductContext,
): string {
  const availableSizes = getAvailableSizes(productContext);

  if (!availableSizes.length) {
    return `مقاس ${size} ما نقدرش نأكدو دابا. نقدر نراجع المقاسات المتوفرة من عند صاحب المتجر.`;
  }

  return `مقاس ${size} ما متوفرش حالياً. المقاسات المتوفرة هي: ${formatNaturalList(
    availableSizes,
  )}.`;
}

function validateIncomingOrderEntities(
  entities: Partial<OrderEntities>,
  productContext: ProductContext,
): { entities: Partial<OrderEntities>; reply?: string } {
  const fieldValidation = validateOrderEntities(entities, productContext);

  for (const invalidField of fieldValidation.invalidFields) {
    const field = invalidField as keyof OrderEntities;

    recordInvalidCandidateRejected({
      field,
      value: entities[field],
    });
  }

  const validEntities = fieldValidation.validEntities;

  if (
    typeof validEntities.color === "string" &&
    validEntities.color.trim() &&
    !isAvailableColorValue(validEntities.color, productContext)
  ) {
    return {
      entities: {
        ...validEntities,
        color: undefined,
      },
      reply: buildUnavailableColorReply(validEntities.color, productContext),
    };
  }

  if (
    typeof validEntities.size === "string" &&
    validEntities.size.trim() &&
    !isAvailableSizeValue(validEntities.size, productContext)
  ) {
    return {
      entities: {
        ...validEntities,
        size: undefined,
      },
      reply: buildUnavailableSizeReply(validEntities.size, productContext),
    };
  }

  return { entities: validEntities };
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
    (field) =>
      !hasValue(collected[field]) ||
      !isValidOrderField(field, collected[field], productContext),
  );
}

async function sanitizeStoredOrderState(
  session: ConversationSession,
  productContext: ProductContext,
): Promise<ConversationSession> {
  const collected: OrderEntities = { ...session.orderState.collected };
  let changed = false;

  if (session.orderState.confirmed) {
    return session;
  }

  for (const [field, value] of Object.entries(collected) as Array<[
    keyof OrderEntities,
    OrderEntities[keyof OrderEntities],
  ]>) {
    if (!hasValue(value)) {
      continue;
    }

    if (!isValidOrderField(field, value, productContext)) {
      delete collected[field];
      changed = true;
      recordInvalidExistingCleared({
        field,
        value,
      });
    }
  }

  const color = collected.color;

  if (
    typeof color === "string" &&
    color.trim() &&
    !isAvailableColorValue(color, productContext)
  ) {
    delete collected.color;
    changed = true;
    recordInvalidExistingCleared({
      field: "color",
      value: color,
    });
  }

  const size = collected.size;

  if (
    typeof size === "string" &&
    size.trim() &&
    !isAvailableSizeValue(size, productContext)
  ) {
    delete collected.size;
    changed = true;
    recordInvalidExistingCleared({
      field: "size",
      value: size,
    });
  }

  if (!changed) {
    return session;
  }

  session.orderState = {
    ...session.orderState,
    collected,
    missingFields: computeMissingFields(collected, productContext),
    isComplete: false,
    awaitingConfirmation: false,
    confirmed: false,
    lastUpdatedAt: new Date().toISOString(),
  };

  await saveConversationSession(session);

  return session;
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
      normalizedMessage.includes(normalizeText(alias)) ||
      normalizedMessage.replace(/\s+/g, "").includes(
        normalizeText(alias).replace(/\s+/g, ""),
      ),
    ),
  )?.city;
}

function findColor(message: string): string | undefined {
  const normalizedMessage = normalizeText(message);
  const normalizedCompactMessage = normalizedMessage.replace(/\s+/g, "");
  const mentionsCasablanca =
    normalizedMessage.includes("الدار البيضاء") ||
    normalizedCompactMessage.includes("الدارالبيضاء") ||
    normalizedMessage.includes("دار البيضاء") ||
    normalizedCompactMessage.includes("دارالبيضاء") ||
    normalizedMessage.includes("كازا") ||
    /\bcasa\b|\bcasablanca\b/i.test(normalizedMessage);

  return colorAliases.find((colorAlias) =>
    colorAlias.aliases.some((alias) => {
      if (colorAlias.color === "أبيض" && mentionsCasablanca) {
        return false;
      }

      return normalizedMessage.includes(normalizeText(alias));
    }),
  )?.color;
}

function isKnownCityOnly(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return cityAliases.some((cityAlias) =>
    cityAlias.aliases.some((alias) => normalizedMessage === normalizeText(alias)),
  );
}

function isKnownColorOnly(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return colorAliases.some((colorAlias) =>
    colorAlias.aliases.some((alias) => normalizedMessage === normalizeText(alias)),
  );
}

function findSize(message: string): string | undefined {
  const selectedSizeMatch = message.trim().match(/^size:(3[6-9]|4[0-5])$/i);

  if (selectedSizeMatch?.[1]) {
    return selectedSizeMatch[1];
  }

  const labeledLetterSizeMatch = message.match(
    /(?:size|taille|مقاس|قياس)\s*(xxl|xl|xs|s|m|l)\b/i,
  );

  if (labeledLetterSizeMatch?.[1]) {
    return labeledLetterSizeMatch[1].toUpperCase();
  }

  const sizeMatch = message.match(/\b(3[6-9]|4[0-5])\b/i);

  return sizeMatch?.[1]?.toUpperCase();
}

function findQuantity(message: string): number | undefined {
  if (
    /(^|\s)1(\s|$)/.test(message) ||
    includesAny(normalizeText(message), [
      "wa7da",
      "wahda",
      "w7da",
      "wahed",
      "wahd",
      "واحدة",
      "وحدة",
      "واحد",
    ])
  ) {
    return 1;
  }

  if (
    /(^|\s)2(\s|$)/.test(message) ||
    includesAny(normalizeText(message), ["jouj", "jooj", "jوج", "جوج", "زوج"])
  ) {
    return 2;
  }

  return undefined;
}

function stripAfterQuantityMarker(text: string): string {
  return text
    .replace(/(الكمية|كمية|quantity|qte|qty|عدد).*$/i, "")
    .trim();
}

function findAddress(message: string): string | undefined {
  const normalizedMessage = normalizeText(message);
  const labeledAddressMatch = normalizedMessage.match(
    /(العنوان|address|adresse)\s+(.+)/i,
  );

  if (labeledAddressMatch?.[2]) {
    const address = stripAfterQuantityMarker(labeledAddressMatch[2]);

    return looksLikeAddressText(address) ? address : undefined;
  }

  const addressMatch = normalizedMessage.match(/(حي|شارع|زنقة|رقم)\s+(.+)/);

  if (!addressMatch) {
    return undefined;
  }

  const address = stripAfterQuantityMarker(
    `${addressMatch[1]} ${addressMatch[2]}`,
  );

  return looksLikeAddressText(address) ? address : undefined;
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
  const address = stripAfterQuantityMarker(addressCandidate);

  return looksLikeAddressText(address) ? normalizeText(address) : undefined;
}

function cleanLabeledValue(value: string): string {
  return value
    .replace(/^(هو|هي|ديالي|ديال|ب|:|-)\s*/i, "")
    .replace(
      /\b(الاسم|السميه|السمية|الهاتف|التلفون|تلفون|رقم الهاتف|رقم|المدينة|العنوان|المقاس|قياس|اللون|الكمية|name|nom|phone|tel|city|ville|address|adresse|size|taille|color|couleur|quantity|qte)\b.*$/i,
      "",
    )
    .trim();
}

function findLabeledValue(message: string, labels: string[]): string | undefined {
  const normalizedMessage = normalizeText(message);

  for (const label of labels) {
    const normalizedLabel = normalizeText(label);
    const labelIndex = normalizedMessage.indexOf(normalizedLabel);

    if (labelIndex < 0) {
      continue;
    }

    const value = cleanLabeledValue(
      normalizedMessage.slice(labelIndex + normalizedLabel.length).trim(),
    );

    if (value) {
      return value;
    }
  }

  return undefined;
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
  const looksLikeOrderCommand = includesAny(normalizedMessage, [
    "بغيت",
    "نكوموندي",
    "نكومندي",
    "نكوموند",
    "نطلب",
    "الطلب",
    "كومند",
    "كوموند",
    "كوموندي",
    "صوب",
    "صايب",
    "دير ليا",
  ]);
  const looksLikeQuestionOrSmallTalk =
    normalizedMessage.includes("؟") ||
    includesAny(normalizedMessage, [
      "شنو",
      "واش",
      "اش",
      "رأيك",
      "رايك",
      "الماتش",
      "ماتش",
      "كيفاش",
      "فين",
      "علاش",
    ]);

  return (
    /^[\u0600-\u06ff\s]{2,30}$/.test(normalizedMessage) &&
    !looksLikeOrderCommand &&
    !looksLikeQuestionOrSmallTalk &&
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

function mergeCorrectedEntities(
  existing: OrderEntities,
  incoming: Partial<OrderEntities>,
): OrderEntities {
  const merged: OrderEntities = { ...existing };

  for (const [key, value] of Object.entries(incoming) as Array<[
    keyof OrderEntities,
    OrderEntities[keyof OrderEntities],
  ]>) {
    if (hasValue(value)) {
      (merged[key] as typeof value) = value;
    }
  }

  return merged;
}

function isStandaloneSizeSelection(message: string, size?: string): boolean {
  if (!size) {
    return false;
  }

  return normalizeText(message) === normalizeText(size);
}

function hasCollectedOrderData(collected: OrderEntities): boolean {
  return Object.values(collected).some((value) => hasValue(value));
}

function isConfirmationMessage(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  if (
    hasRejectionIntent(normalizedMessage) ||
    includesAny(normalizedMessage, correctionKeywords)
  ) {
    return false;
  }

  return confirmationMessages.some((messagePattern) => {
    const normalizedPattern = normalizeText(messagePattern);

    return (
      normalizedMessage === normalizedPattern ||
      normalizedMessage.startsWith(`${normalizedPattern} `) ||
      normalizedMessage.endsWith(` ${normalizedPattern}`) ||
      normalizedMessage.includes(` ${normalizedPattern} `)
    );
  });
}

function hasRejectionIntent(normalizedMessage: string): boolean {
  return (
    isExactMessage(normalizedMessage, negativeCorrectionMessages) ||
    normalizedMessage.startsWith("لا ")
  );
}

function isCancellationMessage(message: string): boolean {
  return isExactMessage(normalizeText(message), cancellationMessages);
}

function hasCorrectionOrRejectionIntent(message: string): boolean {
  const normalizedMessage = normalizeText(message);

  return (
    hasRejectionIntent(normalizedMessage) ||
    includesAny(normalizedMessage, correctionKeywords)
  );
}

function hasFieldKeyword(normalizedMessage: string, labels: string[]): boolean {
  return includesAny(normalizedMessage, labels);
}

function extractCorrectionEntities(message: string): Partial<OrderEntities> {
  const normalizedMessage = normalizeText(message);
  const corrections: Partial<OrderEntities> = {};
  const wantsChange = includesAny(normalizedMessage, correctionKeywords);
  const phone = findPhone(message);
  const hasPhoneKeyword = hasFieldKeyword(normalizedMessage, [
    "رقم الهاتف",
    "الهاتف",
    "التلفون",
    "تلفون",
    "رقم",
    "phone",
    "tel",
  ]);
  const hasCityKeyword = hasFieldKeyword(normalizedMessage, [
    "المدينة",
    "مدينه",
    "ville",
    "city",
  ]);
  const hasAddressKeyword = hasFieldKeyword(normalizedMessage, [
    "العنوان",
    "address",
    "adresse",
  ]);
  const hasSizeKeyword = hasFieldKeyword(normalizedMessage, [
    "المقاس",
    "قياس",
    "size",
    "taille",
  ]);
  const hasColorKeyword = hasFieldKeyword(normalizedMessage, [
    "اللون",
    "لون",
    "color",
    "couleur",
  ]);
  const hasQuantityKeyword = hasFieldKeyword(normalizedMessage, [
    "الكمية",
    "كمية",
    "quantity",
    "qte",
  ]);

  const fullName = findLabeledValue(message, [
    "الاسم الكامل",
    "الإسم الكامل",
    "الاسم",
    "الإسم",
    "السميه",
    "السمية",
    "name",
    "nom",
  ]);

  if (fullName) {
    corrections.fullName = fullName;
  }

  if (phone && (hasPhoneKeyword || wantsChange || normalizedMessage === phone)) {
    corrections.phone = phone;

    if (!corrections.fullName) {
      corrections.fullName = findNameBeforePhone(message, phone);
    }
  }

  const city = findCity(message);

  if (city && (hasCityKeyword || wantsChange || isKnownCityOnly(message))) {
    corrections.city = city;
  }

  const labeledAddress = findLabeledValue(message, [
    "العنوان",
    "address",
    "adresse",
  ]);
  const address =
    labeledAddress ||
    (phone ? findAddressAfterPhone(message, phone) : undefined) ||
    (hasAddressKeyword ||
    wantsChange ||
    /^(حي|شارع|زنقة|رقم)\b/.test(normalizedMessage)
      ? findAddress(message)
      : undefined);

  if (address && looksLikeAddressText(address)) {
    corrections.address = address;
  }

  const size = findSize(message);

  if (size && (hasSizeKeyword || wantsChange)) {
    corrections.size = size;
  }

  const color = findColor(message);

  if (color && (hasColorKeyword || wantsChange || isKnownColorOnly(message))) {
    corrections.color = color;
  }

  const quantity = findQuantity(message);

  if (quantity && (hasQuantityKeyword || wantsChange)) {
    corrections.quantity = quantity;
  }

  return cleanEntities(corrections);
}

async function processConfirmationTurn(input: {
  session: ConversationSession;
  customerId: string;
  sellerId?: string;
  productId?: string;
  message: string;
  productContext: ProductContext;
}): Promise<ProcessOrderTurnResult> {
  if (isConfirmationMessage(input.message)) {
    const missingFields = computeMissingFields(
      input.session.orderState.collected,
      input.productContext,
    );

    if (missingFields.length > 0) {
      await updateConversationOrderState({
        customerId: input.customerId,
        sellerId: input.sellerId,
        productId: input.productId,
        collected: input.session.orderState.collected,
        missingFields,
        isComplete: false,
        awaitingConfirmation: false,
        confirmed: false,
      });
      recordOrderConfirmationBlockedInvalidFields({
        invalidFields: missingFields,
      });

      return {
        handled: true,
        reply: buildOrderProgressReply({
          collected: input.session.orderState.collected,
          missingFields,
          isComplete: false,
          productContext: input.productContext,
        }),
        isComplete: false,
        missingFields,
      };
    }

    const confirmedOrder = saveConfirmedOrder({
      customerId: input.customerId,
      productContext: input.productContext,
      collected: input.session.orderState.collected,
    });
    createNewConfirmedOrderNotification(confirmedOrder);

    await updateConversationOrderState({
      customerId: input.customerId,
      sellerId: input.sellerId,
      productId: input.productId,
      collected: input.session.orderState.collected,
      missingFields: [],
      isComplete: true,
      awaitingConfirmation: false,
      confirmed: true,
    });

    return {
      handled: true,
      reply: "تم تأكيد الطلب ديالك بنجاح. غادي نتواصلو معاك قريباً.",
      isComplete: true,
      missingFields: [],
    };
  }

  if (isCancellationMessage(input.message)) {
    await updateConversationOrderState({
      customerId: input.customerId,
      sellerId: input.sellerId,
      productId: input.productId,
      collected: input.session.orderState.collected,
      missingFields: [],
      isComplete: false,
      awaitingConfirmation: false,
      confirmed: false,
    });

    return {
      handled: true,
      reply: orderCancelledReply,
      isComplete: false,
      missingFields: [],
    };
  }

  const corrections = extractCorrectionEntities(input.message);

  if (Object.keys(corrections).length > 0) {
    const validatedCorrections = validateIncomingOrderEntities(
      corrections,
      input.productContext,
    );

    if (validatedCorrections.reply) {
      return {
        handled: true,
        reply: validatedCorrections.reply,
        isComplete: input.session.orderState.isComplete,
        missingFields: input.session.orderState.missingFields,
      };
    }

    const collected = mergeCorrectedEntities(
      input.session.orderState.collected,
      validatedCorrections.entities,
    );
    const missingFields = computeMissingFields(collected, input.productContext);
    const isComplete = missingFields.length === 0;

    await updateConversationOrderState({
      customerId: input.customerId,
      sellerId: input.sellerId,
      productId: input.productId,
      collected,
      missingFields,
      isComplete,
      awaitingConfirmation: isComplete,
      confirmed: false,
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

  return {
    handled: true,
    reply: hasCorrectionOrRejectionIntent(input.message)
      ? correctionClarificationReply
      : "ما فهمتش واش نأكد الطلب ولا بغيتي تبدل شي معلومة. عافاك جاوب بنعم للتأكيد، أو قول ليا شنو بغيتي تبدل.",
    isComplete: input.session.orderState.isComplete,
    missingFields: input.session.orderState.missingFields,
  };
}

async function processConfirmedOrderTurn(input: {
  session: ConversationSession;
  customerId: string;
  sellerId?: string;
  productId?: string;
}): Promise<ProcessOrderTurnResult> {
  if (input.session.orderState.awaitingConfirmation) {
    await updateConversationOrderState({
      customerId: input.customerId,
      sellerId: input.sellerId,
      productId: input.productId,
      collected: input.session.orderState.collected,
      missingFields: input.session.orderState.missingFields,
      isComplete: input.session.orderState.isComplete,
      awaitingConfirmation: false,
      confirmed: true,
    });
  }

  return {
    handled: true,
    reply: alreadyConfirmedReply,
    isComplete: input.session.orderState.isComplete,
    missingFields: input.session.orderState.missingFields,
  };
}

function shouldTreatAsOrderFlow(input: {
  intent?: string;
  existingCollected: OrderEntities;
  currentMissingFields: string[];
  standaloneEntities: Partial<OrderEntities>;
  hasActiveOrderFlow: boolean;
}): boolean {
  if (
    input.intent === "order_intent" ||
    input.intent === "order_info_provided" ||
    input.intent === "order_start" ||
    input.intent === "order_followup"
  ) {
    return true;
  }

  if (!hasCollectedOrderData(input.existingCollected)) {
    return (
      input.hasActiveOrderFlow &&
      input.currentMissingFields.length > 0 &&
      hasCollectedOrderData(input.standaloneEntities)
    );
  }

  return input.currentMissingFields.length > 0;
}

export async function processOrderTurn(
  input: ProcessOrderTurnInput,
): Promise<ProcessOrderTurnResult> {
  const session = await sanitizeStoredOrderState(
    await getConversationSession(
      input.customerId,
      input.sellerId,
      input.productId,
    ),
    input.productContext,
  );

  if (session.orderState.confirmed) {
    return processConfirmedOrderTurn({
      session,
      customerId: input.customerId,
      sellerId: input.sellerId,
      productId: input.productId,
    });
  }

  if (
    session.orderState.awaitingConfirmation &&
    session.orderState.isComplete &&
    !session.orderState.confirmed
  ) {
    return processConfirmationTurn({
      session,
      customerId: input.customerId,
      sellerId: input.sellerId,
      productId: input.productId,
      message: input.message,
      productContext: input.productContext,
    });
  }

  const fastAnalysis = fastAnalyzeCustomerMessage(input.message);
  const analysis = input.analysis || fastAnalysis;
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
    hasActiveOrderFlow: session.orderState.missingFields.length > 0,
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
  const validatedIncomingEntities = validateIncomingOrderEntities(
    incomingEntities,
    input.productContext,
  );

  if (validatedIncomingEntities.reply) {
    return {
      handled: true,
      reply: validatedIncomingEntities.reply,
      isComplete: session.orderState.isComplete,
      missingFields: currentMissingFields,
    };
  }

  const shouldUpdateSelectedSize =
    session.orderState.missingFields.length > 0 &&
    isStandaloneSizeSelection(input.message, validatedIncomingEntities.entities.size);
  const collected = shouldUpdateSelectedSize
    ? mergeEntities(
        mergeCorrectedEntities(session.orderState.collected, {
          size: validatedIncomingEntities.entities.size,
        }),
        {
          ...validatedIncomingEntities.entities,
          size: undefined,
        },
      )
    : mergeEntities(
        session.orderState.collected,
        validatedIncomingEntities.entities,
      );
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
    confirmed: false,
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
