import type { ProductContext } from "./product-context.types";

type AttributeKind =
  | "battery"
  | "longevity"
  | "warranty"
  | "condition"
  | "authenticity"
  | "material"
  | "ram"
  | "storage";

type AttributeDefinition = {
  kind: AttributeKind;
  label: string;
  messageKeywords: string[];
  attributeKeys: string[];
  missingReply: string;
};

const attributeDefinitions: AttributeDefinition[] = [
  {
    kind: "battery",
    label: "البطارية",
    messageKeywords: ["بطارية", "batterie", "battery", "صحة البطارية"],
    attributeKeys: ["البطارية", "Battery", "battery", "batteryHealth", "صحة البطارية"],
    missingReply:
      "معلومة البطارية ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
  },
  {
    kind: "longevity",
    label: "الثبات",
    messageKeywords: [
      "كيبقى",
      "كتبقى",
      "ثبات",
      "ثابت",
      "مدة طويلة",
      "long lasting",
      "tenue",
    ],
    attributeKeys: ["الثبات", "ثبات", "longevity", "stability", "tenue"],
    missingReply:
      "معلومة الثبات ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
  },
  {
    kind: "warranty",
    label: "الضمان",
    messageKeywords: ["ضمان", "garantie", "warranty"],
    attributeKeys: ["الضمان", "ضمان", "warranty", "garantie"],
    missingReply:
      "معلومة الضمان ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
  },
  {
    kind: "condition",
    label: "الحالة",
    messageKeywords: ["جديد", "مستعمل", "الحالة", "condition"],
    attributeKeys: ["الحالة", "condition", "جديد", "مستعمل"],
    missingReply:
      "معلومة الحالة ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
  },
  {
    kind: "authenticity",
    label: "الأصالة",
    messageKeywords: ["أصلي", "اصلي", "اوريجينال", "original", "authentic"],
    attributeKeys: ["الأصالة", "أصلي", "اصلي", "original", "authenticity"],
    missingReply:
      "هاد المعلومة ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
  },
  {
    kind: "material",
    label: "المادة",
    messageKeywords: ["المادة", "ثوب", "fabric", "material", "جلد"],
    attributeKeys: ["المادة", "الثوب", "material", "fabric", "جلد"],
    missingReply:
      "هاد المعلومة ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
  },
  {
    kind: "ram",
    label: "الرام",
    messageKeywords: ["ram", "رام"],
    attributeKeys: ["ram", "RAM", "الرام"],
    missingReply:
      "هاد المعلومة ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
  },
  {
    kind: "storage",
    label: "التخزين",
    messageKeywords: ["مساحة", "جيجا", "تخزين", "storage"],
    attributeKeys: ["مساحة", "التخزين", "storage", "stockage", "ذاكرة"],
    missingReply:
      "هاد المعلومة ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
  },
];

const colorDefinitions = [
  {
    replyName: "الأبيض",
    values: ["أبيض", "ابيض", "الأبيض", "الابيض", "بيضاء", "white", "blanc"],
  },
  {
    replyName: "الأسود",
    values: ["أسود", "اسود", "الأسود", "الاسود", "كحل", "black", "noir"],
  },
  {
    replyName: "الوردي",
    values: ["وردي", "الوردي", "روز", "rose", "pink"],
  },
  {
    replyName: "الأحمر",
    values: ["أحمر", "احمر", "الأحمر", "الاحمر", "حمرة", "حمر", "red", "rouge"],
  },
  {
    replyName: "الأزرق",
    values: ["أزرق", "ازرق", "الأزرق", "الازرق", "blue", "bleu"],
  },
  {
    replyName: "الأخضر",
    values: ["أخضر", "اخضر", "الأخضر", "الاخضر", "green", "vert"],
  },
  {
    replyName: "الرمادي",
    values: ["رمادي", "الرمادي", "gris", "gray", "grey"],
  },
  {
    replyName: "البيج",
    values: ["beige", "بيج", "البيج"],
  },
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();
}

function normalizeComparable(text: string): string {
  return normalizeText(text).replace(/^ال/, "");
}

function includesAny(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) =>
    normalizeText(message).includes(normalizeText(keyword)),
  );
}

function formatNaturalList(items: string[]): string {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);

  if (cleanItems.length <= 1) {
    return cleanItems.join("");
  }

  return `${cleanItems.slice(0, -1).join("، ")} و${cleanItems[cleanItems.length - 1]}`;
}

function formatColorList(colors: string[]): string {
  return formatNaturalList(
    colors.map((color) => {
      const normalized = normalizeComparable(color);
      const knownColor = colorDefinitions.find((definition) =>
        definition.values.some((value) => normalizeComparable(value) === normalized),
      );

      return knownColor?.replyName || color;
    }),
  );
}

function getPaymentText(productContext: ProductContext): string {
  const methods = productContext.paymentMethods?.filter(Boolean) || [];

  if (!methods.length) {
    return "";
  }

  if (methods.some((method) => method.includes("عند الاستلام"))) {
    return "الدفع عند الاستلام";
  }

  return `الدفع متوفر ب ${formatNaturalList(methods)}`;
}

function getDeliveryText(productContext: ProductContext): string {
  if (productContext.deliveryInfo) {
    return productContext.deliveryInfo;
  }

  const areas = productContext.deliveryAreas?.filter(Boolean) || [];

  if (!areas.length) {
    return "";
  }

  const areaText = formatNaturalList(areas);

  return areaText.includes("جميع")
    ? `التوصيل متوفر ل${areaText}`
    : `التوصيل متوفر ل ${areaText}`;
}

function getPriceReply(productContext: ProductContext): string | null {
  if (!productContext.price) {
    return "الثمن ما متوفرش عندي دابا، نقدر نأكدو لك من عند صاحب المتجر.";
  }

  const price = [productContext.price, productContext.currency]
    .filter(Boolean)
    .join(" ");
  const offer = productContext.offer ? ` والعرض: ${productContext.offer}.` : "";

  return `الثمن هو ${price}.${offer}`;
}

function detectSpecificSize(message: string): string | null {
  const sizeMatch = message.match(/\b(3[6-9]|4[0-5]|xxl|xl|xs|s|m|l)\b/i);

  return sizeMatch?.[1]?.toUpperCase() || null;
}

function getColorFromMessage(message: string) {
  const normalizedMessage = normalizeText(message);

  return colorDefinitions.find((definition) =>
    definition.values.some((value) => normalizedMessage.includes(normalizeText(value))),
  );
}

function isAvailableColor(requestedColor: NonNullable<ReturnType<typeof getColorFromMessage>>, productContext: ProductContext): boolean {
  return Boolean(
    productContext.availableColors?.some((color) =>
      requestedColor.values.some(
        (value) => normalizeComparable(value) === normalizeComparable(color),
      ),
    ),
  );
}

function isAvailableSize(size: string, productContext: ProductContext): boolean {
  return Boolean(
    productContext.availableSizes?.some(
      (availableSize) =>
        normalizeComparable(availableSize) === normalizeComparable(size),
    ),
  );
}

function findFaqAnswer(
  definition: AttributeDefinition,
  productContext: ProductContext,
): string | null {
  const faqs = productContext.faqs || [];

  for (const faq of faqs) {
    const normalizedQuestion = normalizeText(faq.question);
    const matches = definition.messageKeywords.some((keyword) =>
      normalizedQuestion.includes(normalizeText(keyword)),
    );

    if (matches && faq.answer) {
      return faq.answer;
    }
  }

  return null;
}

function findFeatureValue(
  definition: AttributeDefinition,
  productContext: ProductContext,
): string | null {
  if (!["ram", "storage"].includes(definition.kind)) {
    return null;
  }

  const features = productContext.features || [];
  const matchingFeature = features.find((feature) =>
    definition.messageKeywords.some((keyword) =>
      normalizeText(feature).includes(normalizeText(keyword)),
    ),
  );

  return matchingFeature || null;
}

function findAttributeValue(
  definition: AttributeDefinition,
  productContext: ProductContext,
): string | null {
  if (definition.kind === "warranty" && productContext.warrantyInfo) {
    return productContext.warrantyInfo;
  }

  if (definition.kind === "condition" && productContext.condition) {
    return productContext.condition;
  }

  for (const [key, value] of Object.entries(productContext.attributes || {})) {
    const normalizedKey = normalizeComparable(key);
    const matches = definition.attributeKeys.some((attributeKey) => {
      const normalizedAttributeKey = normalizeComparable(attributeKey);

      return (
        normalizedKey === normalizedAttributeKey ||
        normalizedKey.includes(normalizedAttributeKey) ||
        normalizedAttributeKey.includes(normalizedKey)
      );
    });

    if (matches && value) {
      return value;
    }
  }

  return (
    findFaqAnswer(definition, productContext) ||
    findFeatureValue(definition, productContext)
  );
}

function getAttributeReply(
  message: string,
  productContext: ProductContext,
): string | null {
  const definition = attributeDefinitions.find((attributeDefinition) =>
    includesAny(message, attributeDefinition.messageKeywords),
  );

  if (!definition) {
    return null;
  }

  const value = findAttributeValue(definition, productContext);

  if (!value) {
    return definition.missingReply;
  }

  const prefix = definition.kind === "longevity" ? "نعم، " : "";

  return `${prefix}${definition.label}: ${value}.`;
}

function isDeliveryPaymentQuestion(message: string): boolean {
  return includesAny(message, [
    "توصيل",
    "توصل",
    "توصلني",
    "livraison",
    "الدفع",
    "نخلص",
    "خلص",
    "عند الاستلام",
    "حتى توصلني",
  ]);
}

function isPriceQuestion(message: string): boolean {
  return includesAny(message, [
    "شحال",
    "الثمن",
    "تمن",
    "prix",
    "price",
    "بكم",
    "شحال داير",
  ]);
}

function isImageRequest(message: string): boolean {
  return includesAny(message, [
    "صورة",
    "صور",
    "تصاور",
    "photo",
    "photos",
    "pic",
    "pics",
    "وريني",
    "بين ليا",
  ]);
}

function isSizeQuestion(message: string): boolean {
  return includesAny(message, [
    "مقاس",
    "قياس",
    "size",
    "taille",
    "xl",
    "xxl",
    "36",
    "37",
    "38",
    "39",
    "40",
    "41",
    "42",
    "43",
    "44",
    "45",
  ]);
}

function isColorQuestion(message: string): boolean {
  return includesAny(message, [
    "لون",
    "ألوان",
    "الوان",
    "اللون",
    "color",
    "couleur",
    "الأبيض",
    "الأوردي",
    "الأزرق",
    "الأحمر",
    "الأسود",
    "الأخضر",
    "الرمادي",
    "beige",
    "blanc",
    "noir",
    "rose",
  ]);
}

function isOrderIntent(message: string): boolean {
  return includesAny(message, [
    "بغيت نكوموندي",
    "بغيت نطلب",
    "نكوموندي",
    "نطلب",
    "خديت",
    "بغيت واحد",
    "bghit ncommander",
  ]);
}

function getDeliveryPaymentReply(productContext: ProductContext): string | null {
  const deliveryText = getDeliveryText(productContext);
  const paymentText = getPaymentText(productContext);

  if (deliveryText && paymentText) {
    return `نعم، ${deliveryText}، و${paymentText}.`;
  }

  if (deliveryText) {
    return `نعم، ${deliveryText}.`;
  }

  if (paymentText) {
    return `${paymentText}.`;
  }

  return "معلومات التوصيل والدفع ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
}

function getImageReply(productContext: ProductContext): string {
  return productContext.images?.length
    ? "أكيد، نقدر نرسل لك صور المنتج."
    : "الصور ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
}

function getSizeReply(message: string, productContext: ProductContext): string {
  const availableSizes = productContext.availableSizes?.filter(Boolean) || [];
  const requestedSize = detectSpecificSize(message);

  if (!availableSizes.length) {
    return "معلومة المقاسات ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
  }

  if (requestedSize) {
    return isAvailableSize(requestedSize, productContext)
      ? `نعم، مقاس ${requestedSize} متوفر.`
      : `حالياً مقاس ${requestedSize} ما متوفرش، المقاسات المتوفرة هي: ${formatNaturalList(availableSizes)}.`;
  }

  return `المقاسات المتوفرة هي: ${formatNaturalList(availableSizes)}.`;
}

function getColorReply(message: string, productContext: ProductContext): string {
  const availableColors = productContext.availableColors?.filter(Boolean) || [];
  const requestedColor = getColorFromMessage(message);

  if (!availableColors.length) {
    return "معلومة الألوان ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
  }

  if (requestedColor) {
    return isAvailableColor(requestedColor, productContext)
      ? `نعم، اللون ${requestedColor.replyName.replace(/^ال/, "")} متوفر.`
      : `حالياً اللون ${requestedColor.replyName.replace(/^ال/, "")} ما متوفرش، الألوان المتوفرة هي: ${formatColorList(availableColors)}.`;
  }

  return `الألوان المتوفرة هي: ${formatColorList(availableColors)}.`;
}

function getOrderReply(productContext: ProductContext): string {
  const orderFields = productContext.requiredOrderFields?.filter(Boolean);

  if (!orderFields?.length) {
    return "مرحبا، عافاك صيفط ليا الاسم الكامل، رقم الهاتف، المدينة والعنوان باش نأكد لك الطلب.";
  }

  return `مرحبا، عافاك صيفط ليا ${formatNaturalList(orderFields)} باش نأكد لك الطلب.`;
}

export function getDirectAgentReply(
  message: string,
  productContext: ProductContext,
): string | null {
  const userMessage = message.trim();

  if (!userMessage) {
    return null;
  }

  if (isOrderIntent(userMessage)) {
    return getOrderReply(productContext);
  }

  if (isImageRequest(userMessage)) {
    return getImageReply(productContext);
  }

  if (isDeliveryPaymentQuestion(userMessage)) {
    return getDeliveryPaymentReply(productContext);
  }

  if (isPriceQuestion(userMessage)) {
    return getPriceReply(productContext);
  }

  if (isSizeQuestion(userMessage)) {
    return getSizeReply(userMessage, productContext);
  }

  if (isColorQuestion(userMessage)) {
    return getColorReply(userMessage, productContext);
  }

  return getAttributeReply(userMessage, productContext);
}
