import {
  getColorFromMessage,
  detectSpecificSize,
} from "../direct-answer/intent-detectors";
import type { ProductContext } from "../product-context.types";

export type ProductInfoTopic =
  | "menu"
  | "price"
  | "sizes"
  | "colors"
  | "delivery_payment"
  | "availability"
  | "how_to_order"
  | "order_now";

export type ProductInfoRequest = {
  topic: ProductInfoTopic;
  requestedSize?: string;
  requestedColor?: string;
};

const menuMessages = [
  "first_entry:more_info",
  "info:menu",
  "info:more_info",
  "المزيد من المعلومات",
  "معلومات أخرى",
  "معلومات اخرى",
  "more info",
];

const orderNowMessages = [
  "info:order_now",
  "info:continue_order",
  "order:continue",
  "أطلب الآن",
  "اطلب الآن",
  "نبدأ الطلب",
  "نبدا الطلب",
  "نكمل الطلب",
  "كمل الطلب",
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[؟?،,.;!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isExact(message: string, values: string[]): boolean {
  const normalizedMessage = normalizeText(message);

  return values.some((value) => normalizeText(value) === normalizedMessage);
}

function includesAny(message: string, values: string[]): boolean {
  const normalizedMessage = normalizeText(message);

  return values.some((value) =>
    normalizedMessage.includes(normalizeText(value)),
  );
}

function normalizeComparable(value: string): string {
  return normalizeText(value).replace(/^ال/, "");
}

function findAvailableColor(
  requestedColor: string | undefined,
  productContext: ProductContext,
): string | undefined {
  if (!requestedColor?.trim()) {
    return undefined;
  }

  const comparableRequestedColor = normalizeComparable(requestedColor);

  return productContext.availableColors?.find(
    (color) => normalizeComparable(color) === comparableRequestedColor,
  );
}

function findAvailableSize(
  requestedSize: string | undefined,
  productContext: ProductContext,
): string | undefined {
  if (!requestedSize?.trim()) {
    return undefined;
  }

  const comparableRequestedSize = normalizeComparable(requestedSize);

  return productContext.availableSizes?.find(
    (size) => normalizeComparable(size) === comparableRequestedSize,
  );
}

function looksLikeQuestion(message: string): boolean {
  return (
    /[؟?]/.test(message) ||
    includesAny(message, ["واش", "شنو", "شحال", "wach", "chno", "kayn", "كاين"])
  );
}

export function resolveProductInfoRequest(
  message: string,
): ProductInfoRequest | null {
  const cleanMessage = message.trim();

  if (!cleanMessage) {
    return null;
  }

  if (isExact(cleanMessage, orderNowMessages)) {
    return { topic: "order_now" };
  }

  if (isExact(cleanMessage, menuMessages)) {
    return { topic: "menu" };
  }

  const explicitTopic = cleanMessage.match(/^info:(.+)$/i)?.[1]?.toLowerCase();

  if (
    explicitTopic &&
    [
      "price",
      "sizes",
      "colors",
      "delivery_payment",
      "availability",
      "how_to_order",
    ].includes(explicitTopic)
  ) {
    return { topic: explicitTopic as ProductInfoTopic };
  }

  if (
    includesAny(cleanMessage, [
      "شحال الثمن",
      "شحال تمن",
      "الثمن",
      "التمن",
      "prix",
      "price",
      "bchhal",
      "bch7al",
      "bach7l",
      "ch7al",
      "taman",
    ])
  ) {
    return { topic: "price" };
  }

  const requestedSize = detectSpecificSize(cleanMessage) || undefined;
  const hasSizeTerm = includesAny(cleanMessage, [
    "المقاسات",
    "القياسات",
    "مقاس",
    "قياس",
    "سايز",
    "size",
    "sizes",
    "pointure",
    "pointures",
    "taille",
  ]);

  if (hasSizeTerm || (requestedSize && looksLikeQuestion(cleanMessage))) {
    return { topic: "sizes", requestedSize };
  }

  const requestedColor = getColorFromMessage(cleanMessage)?.replyName.replace(
    /^ال/,
    "",
  );
  const hasColorTerm = includesAny(cleanMessage, [
    "الألوان",
    "الالوان",
    "ألوان",
    "الوان",
    "اللون",
    "لون",
    "color",
    "colors",
    "couleur",
    "alwan",
  ]);

  if (hasColorTerm || (requestedColor && looksLikeQuestion(cleanMessage))) {
    return { topic: "colors", requestedColor };
  }

  if (
    includesAny(cleanMessage, [
      "التوصيل",
      "توصيل",
      "الدفع عند الاستلام",
      "الدفع",
      "عند الاستلام",
      "livraison",
      "paiement",
      "cash on delivery",
      "delivery",
    ])
  ) {
    return { topic: "delivery_payment" };
  }

  if (
    includesAny(cleanMessage, [
      "واش متوفر",
      "واش كاين",
      "wach kayn",
      "disponible",
      "available",
    ])
  ) {
    return { topic: "availability" };
  }

  if (
    includesAny(cleanMessage, [
      "كيفاش نطلب",
      "كيفاش ندير الطلب",
      "طريقة الطلب",
      "kifach ntleb",
      "kifach ncommandi",
      "comment commander",
      "how to order",
    ])
  ) {
    return { topic: "how_to_order" };
  }

  return null;
}

export function normalizeInfoOrderMessage(message: string): string {
  return resolveProductInfoRequest(message)?.topic === "order_now"
    ? "first_entry:order_now"
    : message;
}

export function getInfoSelectionFromMessage(
  message: string,
  productContext: ProductContext,
): { field: string; value: string } | null {
  const cleanMessage = message.trim();
  const explicitSize = cleanMessage.match(/^size:(.+)$/i)?.[1]?.trim();
  const explicitColor = cleanMessage.match(/^color:(.+)$/i)?.[1]?.trim();
  const explicitOption = cleanMessage.match(/^([a-zA-Z][a-zA-Z0-9_-]{0,79}):(.+)$/)?.slice(1);
  if (explicitOption && explicitOption[0] !== "size" && explicitOption[0] !== "color") {
    const [field, rawValue] = explicitOption;
    const value = rawValue.trim();
    const configuredValue = productContext.attributes?.[field] === value
      ? value
      : undefined;

    if (configuredValue) {
      return { field, value: configuredValue };
    }
  }

  const size = findAvailableSize(
    explicitSize || detectSpecificSize(cleanMessage) || cleanMessage,
    productContext,
  );

  if (size) {
    return { field: "size", value: size };
  }

  const requestedColor =
    explicitColor ||
    getColorFromMessage(cleanMessage)?.replyName.replace(/^ال/, "");
  const color = findAvailableColor(requestedColor || cleanMessage, productContext);

  return color ? { field: "color", value: color } : null;
}

export function isProductInfoContinueOrder(message: string): boolean {
  return resolveProductInfoRequest(message)?.topic === "order_now";
}

export function matchAvailableInfoSize(
  size: string | undefined,
  productContext: ProductContext,
): string | undefined {
  return findAvailableSize(size, productContext);
}

export function matchAvailableInfoColor(
  color: string | undefined,
  productContext: ProductContext,
): string | undefined {
  return findAvailableColor(color, productContext);
}
