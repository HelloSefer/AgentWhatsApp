import type { OrderMessageDisposition } from "./order-understanding.types";

export type MessageDispositionDecision = {
  disposition: OrderMessageDisposition;
  consumed: boolean;
  extractionText: string;
  residualText?: string;
  residualExtractionUsed: boolean;
  residualDisposition?: OrderMessageDisposition;
  residualFieldHint?: "city";
};

const exactConfirm = [
  "نعم", "اه", "آه", "واخا", "اكد", "أكد", "نأكد", "صافي", "توكل",
  "توكل على الله", "تمام", "yes", "confirm", "ok", "order:confirm",
];
const exactCancel = [
  "الغاء", "إلغاء", "لغي", "لغي الطلب", "بلا طلب", "cancel", "annuler",
];
const exactGreeting = [
  "سلام", "السلام عليكم", "وعليكم السلام", "salam", "slm", "hello", "bonjour", "bonsoir",
];
const exactThanks = [
  "شكرا", "شكراً", "بارك الله فيك", "الله يعطيك الصحة", "merci", "thanks", "thank you",
];

const newOrderPrefixes: RegExp[] = [
  /^(?:عافاك\s+)?(?:بغيت|باغي|باغية)\s+(?:ندير\s+|دير\s+)?(?:طلب(?:\s+جديد)?|نكوموندي|نكومندي|نكوموند|كوموند|كومند|نطلب|ناخد|ناخذ)/iu,
  /^(?:بغيت\s+)?(?:commande|commander|order|ncommande|ncommandi|nkomandi|nkomand|nakhod|nakhoud)(?=$|[\s،,.;!])/iu,
  /^(?:واش\s+)?(?:تقدر|تقد|قدر|اقدر|اك\s+تقد)\s+(?:تصوب|توجد|تدير)\s+(?:لي|ليا)\s+(?:كومند|كوموند|طلب)(?:\s+ديالي)?/iu,
  /^(?:دير|وجد|صوب|صايب)\s+(?:لي|ليا)\s+(?:الطلب|طلب|كومند|كوموند)/iu,
  /^(?:first_entry:order_now|info:order_now|info:continue_order|order:start|order:continue)/i,
  /^(?:طلب\s+جديد|الطلب|طلب|commande|order|كومند|كوموند|كوموندي)$/iu,
];

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[؟?،,.;:!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isExact(message: string, values: string[]): boolean {
  const normalized = normalize(message);
  return values.some((value) => normalize(value) === normalized);
}

function includesAny(message: string, values: string[]): boolean {
  const normalized = normalize(message);
  return values.some((value) => normalized.includes(normalize(value)));
}

function looksLikeQuestion(message: string): boolean {
  return /[؟?]/.test(message) || includesAny(message, [
    "واش", "وش", "اش", "شنو", "شحال", "كيفاش", "علاش", "فين", "هل", "كم",
    "wach", "ch7al", "chhal", "combien", "est ce", "how", "what", "where",
  ]);
}

function classifyWithoutOrderConsumption(message: string): OrderMessageDisposition {
  const clean = message.trim();
  const normalized = normalize(clean);

  if (!normalized) return "UNKNOWN";
  if (isExact(clean, exactConfirm)) return "CONFIRM";
  if (isExact(clean, exactCancel)) return "CANCEL";
  if (isExact(clean, exactGreeting)) return "GREETING";
  if (isExact(clean, exactThanks)) return "THANKS";

  if (includesAny(clean, ["كيفاش ندير طلب", "كيفاش نطلب", "comment commander", "how to order"])) {
    return "PRODUCT_INFO_QUESTION";
  }

  const deliveryTerms = [
    "التوصيل", "توصيل", "توصلك", "توصلي", "livraison", "delivery",
  ];
  const paymentTerms = [
    "الدفع", "نخلص", "تخلص", "عند الاستلام", "paiement", "payment", "cash on delivery", "cod",
  ];
  const priceTerms = [
    "الثمن", "السعر", "التمن", "شحال", "بشحال", "taman", "prix", "price", "bch7al", "bach7l", "ch7al",
  ];

  if (includesAny(clean, deliveryTerms) && (looksLikeQuestion(clean) || includesAny(clean, ["مجاني", "فابور", "gratuite", "gratuit", "free", "بكم", "تكلفة"]))) {
    return "DELIVERY_QUESTION";
  }
  if (includesAny(clean, paymentTerms) && (looksLikeQuestion(clean) || includesAny(clean, ["كاين", "متوفر", "possible"]))) {
    return "PAYMENT_QUESTION";
  }
  if (includesAny(clean, priceTerms) && looksLikeQuestion(clean)) {
    return "PRICE_QUESTION";
  }
  if (includesAny(clean, ["متوفر", "متوفرة", "كاين", "disponible", "available", "stock"]) && looksLikeQuestion(clean)) {
    return "AVAILABILITY_QUESTION";
  }
  if (includesAny(clean, [
    "شنو كتبيع", "شنو عندكم", "شنو المنتوج", "شنو المنتج", "معلومات المنتج",
    "details", "produit", "product", "الصور", "المقاسات", "الالوان", "الألوان",
  ]) && looksLikeQuestion(clean)) {
    return "PRODUCT_INFO_QUESTION";
  }
  if (includesAny(clean, ["بدل", "نبدل", "صحح", "الصحيح", "غلط", "change", "correct"])) {
    return "FIELD_CORRECTION";
  }
  if (includesAny(clean, ["بغيت نبدل", "تعديل", "order:edit", "confirm:edit"])) {
    return "EDIT";
  }
  if (
    /(?:\+212|0)[67]\d{8}\b/.test(clean) ||
    /^(?:size|color|quantity|fullName|phone|city|address|variant):/i.test(clean) ||
    includesAny(clean, [
      "سميتي", "اسمي", "الاسم", "name", "nom", "رقمي", "الهاتف", "phone", "tel",
      "المدينة", "city", "ville", "العنوان", "address", "adresse", "المقاس", "size",
      "اللون", "color", "couleur", "الكمية", "quantity", "qty",
    ])
  ) {
    return "FIELD_INFORMATION";
  }

  if (
    looksLikeQuestion(clean) &&
    includesAny(clean, [
      "الموديل", "المنتج", "المنتوج", "السلعة", "مريح", "مريحة", "الراحة",
      "واقف", "الخدمة", "استعمال", "مناسب", "مناسبة", "الجودة", "المادة",
      "القماش", "الجلد", "الضمان", "الصنع", "للخروج", "product", "model",
      "comfortable", "comfort", "quality", "material", "fabric", "suitable",
      "usage", "work", "debout", "confort", "matiere", "matière", "qualite",
      "qualité",
    ])
  ) {
    return "PRODUCT_INFO_QUESTION";
  }

  return "UNKNOWN";
}

function cleanResidual(value: string): string {
  return value
    .replace(/^[\s،,.;:!\-]+/u, "")
    .replace(/^(?:و\s*)?(?=(?:سميتي|اسمي|الاسم|رقمي|الهاتف|phone|name|nom)\b)/iu, "")
    .replace(/^(?:في|ف)\s+/iu, "")
    .replace(/^ف(?=[\p{Script=Arabic}])/u, "")
    .trim();
}

function consumeNewOrderPrefix(message: string): { matched: boolean; residualText?: string; residualFieldHint?: "city" } {
  const clean = message.trim();

  for (const pattern of newOrderPrefixes) {
    const match = clean.match(pattern);
    if (!match) continue;

    const rawResidual = clean.slice(match[0].length);
    const residualText = cleanResidual(rawResidual);
    const residualFieldHint = /^[\s،,.;:!\-]*(?:في\s+|ف\s*\p{Script=Arabic})/iu.test(rawResidual)
      ? "city" as const
      : undefined;
    return { matched: true, residualText: residualText || undefined, residualFieldHint };
  }

  return { matched: false };
}

export function classifyOrderMessageDisposition(message: string): MessageDispositionDecision {
  const clean = message.trim();
  const howToOrder = includesAny(clean, ["كيفاش ندير طلب", "كيفاش نطلب", "comment commander", "how to order"]);
  const consumedOrder = howToOrder ? { matched: false } : consumeNewOrderPrefix(clean);

  if (consumedOrder.matched) {
    const residualText = consumedOrder.residualText;
    const residualDisposition = residualText
      ? classifyWithoutOrderConsumption(residualText)
      : undefined;
    const residualIsSafe = Boolean(
      residualText &&
      (residualDisposition === "FIELD_INFORMATION" || residualDisposition === "FIELD_CORRECTION" || residualDisposition === "UNKNOWN"),
    );

    return {
      disposition: "NEW_ORDER",
      consumed: true,
      extractionText: residualIsSafe ? residualText! : "",
      residualText,
      residualExtractionUsed: residualIsSafe,
      residualDisposition,
      residualFieldHint: consumedOrder.residualFieldHint,
    };
  }

  const disposition = classifyWithoutOrderConsumption(clean);
  const extractionAllowed = disposition === "FIELD_INFORMATION" || disposition === "FIELD_CORRECTION" || disposition === "UNKNOWN";

  return {
    disposition,
    consumed: !extractionAllowed,
    extractionText: extractionAllowed ? clean : "",
    residualExtractionUsed: false,
  };
}

export function isSideQuestionDisposition(disposition: OrderMessageDisposition): boolean {
  return [
    "PRICE_QUESTION",
    "DELIVERY_QUESTION",
    "PAYMENT_QUESTION",
    "AVAILABILITY_QUESTION",
    "PRODUCT_INFO_QUESTION",
  ].includes(disposition);
}

export function isFieldExtractionDisposition(disposition: OrderMessageDisposition): boolean {
  return disposition === "FIELD_INFORMATION" || disposition === "FIELD_CORRECTION" || disposition === "UNKNOWN";
}
