export type AttributeKind =
  | "battery"
  | "longevity"
  | "warranty"
  | "condition"
  | "authenticity"
  | "material"
  | "ram"
  | "storage";

export type AttributeDefinition = {
  kind: AttributeKind;
  label: string;
  messageKeywords: string[];
  attributeKeys: string[];
  missingReply: string;
};

export type ColorDefinition = {
  replyName: string;
  values: string[];
};

export const attributeDefinitions: AttributeDefinition[] = [
  {
    kind: "battery",
    label: "البطارية",
    messageKeywords: ["بطارية", "batterie", "battery", "صحة البطارية"],
    attributeKeys: [
      "البطارية",
      "Battery",
      "battery",
      "batteryHealth",
      "صحة البطارية",
    ],
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

export const colorDefinitions: ColorDefinition[] = [
  {
    replyName: "الأبيض",
    values: ["أبيض", "ابيض", "الأبيض", "الابيض", "بيضاء", "white", "blanc"],
  },
  {
    replyName: "الأسود",
    values: [
      "أسود",
      "اسود",
      "الأسود",
      "الاسود",
      "كحل",
      "k7al",
      "k7el",
      "lk7el",
      "black",
      "noir",
    ],
  },
  {
    replyName: "الوردي",
    values: ["وردي", "الوردي", "روز", "rose", "pink"],
  },
  {
    replyName: "الأحمر",
    values: [
      "أحمر",
      "احمر",
      "الأحمر",
      "الاحمر",
      "حمرة",
      "حمر",
      "red",
      "rouge",
    ],
  },
  {
    replyName: "الأصفر",
    values: ["أصفر", "اصفر", "الأصفر", "الاصفر", "صفر", "sfar", "yellow", "jaune"],
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
