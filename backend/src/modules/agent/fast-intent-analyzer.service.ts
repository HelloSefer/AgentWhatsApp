import type {
  AgentBrainAnalysis,
  AgentIntent,
  CustomerLanguage,
  CustomerMood,
  OrderEntities,
} from "./agent-brain.types";

type CityMatch = {
  city: string;
  alias: string;
};

const cityAliases: Array<{ city: string; aliases: string[] }> = [
  { city: "كازا", aliases: ["casa", "casablanca", "كازا", "الدار البيضاء"] },
  { city: "الرباط", aliases: ["rabat", "الرباط"] },
  { city: "فاس", aliases: ["fes", "fès", "فاس"] },
  { city: "مراكش", aliases: ["marrakech", "marrakesh", "مراكش"] },
  { city: "طنجة", aliases: ["tanger", "tangier", "tanja", "طنجة"] },
];

const colorAliases: Array<{ color: string; aliases: string[] }> = [
  {
    color: "أسود",
    aliases: ["k7la", "kahla", "noir", "lk7el", "black", "كحلة", "كحل", "اسود", "أسود", "سوداء"],
  },
  {
    color: "وردي",
    aliases: ["werdi", "wardi", "rose", "lwerdi", "pink", "وردي", "الوردي"],
  },
  {
    color: "أبيض",
    aliases: ["byda", "bayda", "white", "blanc", "ابيض", "أبيض", "بيضاء"],
  },
  {
    color: "أحمر",
    aliases: ["7mra", "hamra", "red", "rouge", "حمراء", "حمر", "احمر", "أحمر"],
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

function includesAny(message: string, keywords: string[]): boolean {
  const normalizedMessage = normalizeText(message);

  return keywords.some((keyword) =>
    normalizedMessage.includes(normalizeText(keyword)),
  );
}

function detectLanguage(message: string): CustomerLanguage {
  const hasArabic = /[\u0600-\u06ff]/.test(message);
  const hasLatin = /[a-z]/i.test(message);

  if (hasArabic && hasLatin) {
    return "mixed";
  }

  if (hasLatin) {
    return "darija_arabizi";
  }

  if (hasArabic) {
    return "darija_arabic";
  }

  return "unknown";
}

function createAnalysis(
  message: string,
  intent: AgentIntent,
  options: {
    confidence?: number;
    mood?: CustomerMood;
    entities?: OrderEntities;
    missingOrderFields?: string[];
    needsHuman?: boolean;
    reasoningNote?: string;
  } = {},
): AgentBrainAnalysis {
  return {
    intent,
    confidence: options.confidence ?? 0.95,
    language: detectLanguage(message),
    mood: options.mood ?? "neutral",
    entities: options.entities ?? {},
    missingOrderFields: options.missingOrderFields ?? [],
    needsHuman: options.needsHuman ?? false,
    reasoningNote: options.reasoningNote,
  };
}

function findPhone(message: string): string | undefined {
  const phoneMatch = message.match(/(?:\+212|0)[67]\d{8}\b/);
  const phone = phoneMatch?.[0];

  if (!phone) {
    return undefined;
  }

  return phone.startsWith("+212") ? `0${phone.slice(4)}` : phone;
}

function findCity(message: string): CityMatch | undefined {
  const normalizedMessage = normalizeText(message);

  for (const cityAlias of cityAliases) {
    const alias = cityAlias.aliases.find((value) =>
      normalizedMessage.includes(normalizeText(value)),
    );

    if (alias) {
      return {
        city: cityAlias.city,
        alias,
      };
    }
  }

  return undefined;
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
    /(?:size|taille|مقاس|قياس)\s*(3[6-9]|4[0-5]|xxl|xl|xs|s|m|l)\b/i,
  );

  if (sizeMatch?.[1]) {
    return sizeMatch[1].toUpperCase();
  }

  const standaloneSizeMatch = message.match(/\b(3[6-9]|4[0-5]|xxl|xl|xs|s|m|l)\b/i);

  return standaloneSizeMatch?.[1]?.toUpperCase();
}

function findQuantity(message: string): number | undefined {
  if (includesAny(message, ["wa7da", "واحدة"]) || /(?:^|\s)1(?:\s|$)/.test(message)) {
    return 1;
  }

  if (includesAny(message, ["جوج", "زوج"]) || /(?:^|\s)2(?:\s|$)/.test(message)) {
    return 2;
  }

  return undefined;
}

function extractOrderEntities(message: string): OrderEntities {
  return {
    color: findColor(message),
    size: findSize(message),
    city: findCity(message)?.city,
    quantity: findQuantity(message),
  };
}

function extractOrderInfoEntities(message: string): OrderEntities {
  const phone = findPhone(message);
  const cityMatch = findCity(message);
  const normalizedMessage = normalizeText(message);
  const normalizedPhone = phone ? normalizeText(phone) : "";
  const phoneIndex = normalizedPhone
    ? normalizedMessage.indexOf(normalizedPhone)
    : -1;
  const fullName =
    phoneIndex > 0
      ? normalizedMessage.slice(0, phoneIndex).trim().split(/\s+/).slice(0, 3).join(" ")
      : undefined;
  const normalizedCityAlias = cityMatch ? normalizeText(cityMatch.alias) : "";
  const cityIndex = normalizedCityAlias
    ? normalizedMessage.indexOf(normalizedCityAlias)
    : -1;
  const address =
    cityIndex >= 0
      ? normalizedMessage.slice(cityIndex + normalizedCityAlias.length).trim()
      : undefined;

  return {
    fullName: fullName || undefined,
    phone,
    city: cityMatch?.city,
    address: address || undefined,
  };
}

function isGreeting(message: string): boolean {
  return ["سلام", "salam", "slm", "السلام عليكم"].includes(
    normalizeText(message),
  );
}

function isProductIdentity(message: string): boolean {
  if (isDeliveryPaymentQuestion(message)) {
    return false;
  }

  return includesAny(message, [
    "شنو كتبيعو",
    "شنو عندكم",
    "شنو كاين",
    "اش كاين",
    "كتبيعو شنو",
    "xno katbi3o",
    "chno katbi3o",
    "ach kayn",
    "chno 3andkom",
    "xno 3andkom",
  ]);
}

function isHumanHandoff(message: string): boolean {
  return includesAny(message, [
    "بغيت نهضر مع شي واحد",
    "بغيت نهضر مع انسان",
    "عطيني شي واحد",
    "بغيت المسؤول",
    "بغيت البائع",
    "bghit nhdr m3a chi wa7d",
    "bghit nhedr m3a insan",
    "bghit seller",
  ]);
}

function isImageRequest(message: string): boolean {
  return includesAny(message, ["sift lia tsawr", "صيفط ليا الصور", "تصاور", "photos", "وريني"]);
}

function isPriceObjection(message: string): boolean {
  return includesAny(message, ["ghali", "غالي", "نقص", "خقص", "دير نقص"]);
}

function isDeliveryPaymentQuestion(message: string): boolean {
  return includesAny(message, [
    "توصيل",
    "التوصيل",
    "توصلني",
    "توصل",
    "الدفع",
    "نخلص",
    "خلص",
    "حتى توصلني",
    "عند الاستلام",
    "livraison",
    "delivery",
    "wach kayn livraison",
    "nkhlss",
    "nkhless",
    "nخلص",
    "twslni",
    "twselni",
    "touslni",
    "mli twslni",
    "paiement",
    "pay",
    "cash on delivery",
  ]);
}

function isOrderVerb(message: string): boolean {
  return includesAny(message, [
    "بغيت",
    "نطلب",
    "نكوموندي",
    "نكومندي",
    "نكموندي",
    "خديت",
    "bghit",
    "ncommandi",
    "ncommander",
    "nkomandi",
  ]);
}

function hasOrderChoice(message: string): boolean {
  return Boolean(
    findColor(message) ||
      findSize(message) ||
      findCity(message) ||
      findQuantity(message) ||
      includesAny(message, ["wa7da", "واحدة"]),
  );
}

function looksLikeOrderInfo(message: string): boolean {
  return Boolean(findPhone(message));
}

export function fastAnalyzeCustomerMessage(
  message: string,
): AgentBrainAnalysis | null {
  const userMessage = message.trim();

  if (!userMessage) {
    return null;
  }

  if (isHumanHandoff(userMessage)) {
    return createAnalysis(userMessage, "human_handoff_request", {
      confidence: 0.98,
      mood: "confused",
      needsHuman: true,
      reasoningNote: "Customer asked for human assistance.",
    });
  }

  if (looksLikeOrderInfo(userMessage)) {
    return createAnalysis(userMessage, "order_info_provided", {
      confidence: 0.96,
      mood: "interested",
      entities: extractOrderInfoEntities(userMessage),
      reasoningNote: "Customer provided order contact details.",
    });
  }

  if (isOrderVerb(userMessage) && hasOrderChoice(userMessage)) {
    return createAnalysis(userMessage, "order_intent", {
      confidence: 0.96,
      mood: "interested",
      entities: extractOrderEntities(userMessage),
      reasoningNote: "Customer wants to order and provided product choices.",
    });
  }

  if (isDeliveryPaymentQuestion(userMessage)) {
    return createAnalysis(userMessage, "delivery_payment_question", {
      confidence: 0.96,
      reasoningNote: "Customer asked about delivery or payment.",
    });
  }

  if (isProductIdentity(userMessage)) {
    return createAnalysis(userMessage, "product_identity", {
      confidence: 0.98,
      reasoningNote: "Customer asks what products are available.",
    });
  }

  if (isGreeting(userMessage)) {
    return createAnalysis(userMessage, "greeting", {
      confidence: 0.98,
      reasoningNote: "Customer greeted the seller.",
    });
  }

  if (isImageRequest(userMessage)) {
    return createAnalysis(userMessage, "image_request", {
      confidence: 0.97,
      mood: "interested",
      reasoningNote: "Customer requested product images.",
    });
  }

  if (isPriceObjection(userMessage)) {
    return createAnalysis(userMessage, "price_objection", {
      confidence: 0.95,
      mood: "price_sensitive",
      reasoningNote: "Customer objected to the price.",
    });
  }

  return null;
}
