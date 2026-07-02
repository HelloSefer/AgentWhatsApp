import type { ProductContext } from "../product-context.types";
import {
  colorDefinitions,
  type ColorDefinition,
} from "./attribute-definitions";
import {
  includesAny,
  normalizeComparable,
  normalizeText,
} from "./text-normalization";

export function detectSpecificSize(message: string): string | null {
  const sizeMatch = message.match(/\b(3[6-9]|4[0-5]|xxl|xl|xs|s|m|l)\b/i);

  return sizeMatch?.[1]?.toUpperCase() || null;
}

export function getColorFromMessage(message: string): ColorDefinition | undefined {
  const normalizedMessage = normalizeText(message);

  return colorDefinitions.find((definition) =>
    definition.values.some((value) =>
      normalizedMessage.includes(normalizeText(value)),
    ),
  );
}

export function isAvailableColor(
  requestedColor: ColorDefinition,
  productContext: ProductContext,
): boolean {
  return Boolean(
    productContext.availableColors?.some((color) =>
      requestedColor.values.some(
        (value) => normalizeComparable(value) === normalizeComparable(color),
      ),
    ),
  );
}

export function isAvailableSize(
  size: string,
  productContext: ProductContext,
): boolean {
  return Boolean(
    productContext.availableSizes?.some(
      (availableSize) =>
        normalizeComparable(availableSize) === normalizeComparable(size),
    ),
  );
}

export function isDeliveryPaymentQuestion(message: string): boolean {
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

export function isPriceQuestion(message: string): boolean {
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

export function isImageRequest(message: string): boolean {
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

export function isSizeQuestion(message: string): boolean {
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

export function isColorQuestion(message: string): boolean {
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

export function isOrderIntent(message: string): boolean {
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

export function isGreeting(message: string): boolean {
  const normalizedMessage = normalizeText(message);
  const greetings = [
    "سلام",
    "السلام",
    "السلام عليكم",
    "salam",
    "slm",
    "salamo",
    "hi",
    "hello",
    "cv",
    "labas",
    "labass",
    "kifach",
    "كيفاش",
    "لباس",
  ];

  return greetings.includes(normalizedMessage);
}

export function isRecommendationQuestion(message: string): boolean {
  return includesAny(message, [
    "شنو تنصحني",
    "شنو تنصحيني",
    "اش تنصحني",
    "اش تنصحيني",
    "آش تنصحني",
    "آش تنصحيني",
    "نصحني",
    "نصحيني",
    "شنو لون تنصحني",
    "شنو اللون اللي تنصحني",
    "شنو نختار",
    "شنو ناخد",
    "شنو احسن",
    "شنو افضل",
    "شنو الأحسن",
    "شنو الأفضل",
    "واش الوردي ولا الأسود",
    "واش الوردي ولا الاسود",
    "أي لون احسن",
    "اي لون احسن",
    "chno tnshni",
    "xno tnshni",
    "ach tnshni",
    "chno nakhd",
    "xno nakhd",
    "chno nختار",
    "chno n5tar",
    "ach n5tar",
    "wach rose wla noir",
    "wach lwerdi wla lk7el",
  ]);
}

export function isProductIdentityQuestion(message: string): boolean {
  if (isDeliveryPaymentQuestion(message)) {
    return false;
  }

  return includesAny(message, [
    "شنو كتبيعو",
    "شنو كتبيع",
    "اش كتبيعو",
    "اش كتبيع",
    "آش كتبيعو",
    "آش كتبيع",
    "شنو عندكم",
    "شنو كاين عندكم",
    "اش كاين",
    "شنو المنتج",
    "شنو السلعة",
    "عندكم شنو",
    "كاتبيعو شنو",
    "كتبيعو شنو",
    "شنو كتسوقو",
    "شنو متوفر",
    "xno katbi3o",
    "xno katbi3",
    "chno katbi3o",
    "chno katbi3",
    "shno katbi3o",
    "ach katbi3o",
    "ach katbi3",
    "chno 3andkom",
    "xno 3andkom",
    "ach kayn",
    "chno kayn",
    "xno kayn",
    "wach katbi3o",
    "wach katbi3",
    "katbi3o chno",
    "katbi3 chno",
    "katchriw chno",
    "shno lproduit",
    "chno produit",
  ]);
}
