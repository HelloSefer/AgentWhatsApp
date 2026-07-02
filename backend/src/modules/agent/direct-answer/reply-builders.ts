import type { ProductContext } from "../product-context.types";
import type { DirectAgentResult } from "./direct-answer.types";
import {
  formatColorList,
  formatColorName,
  formatPriceText,
  formatSizesSummary,
  getDeliveryText,
  getPaymentText,
} from "./product-formatters";
import {
  detectSpecificSize,
  getColorFromMessage,
  isAvailableColor,
  isAvailableSize,
} from "./intent-detectors";
import { formatNaturalList, includesAny } from "./text-normalization";

export function getPriceReply(productContext: ProductContext): string | null {
  if (!productContext.price) {
    return "الثمن ما متوفرش عندي دابا، نقدر نأكدو لك من عند صاحب المتجر.";
  }

  const price = formatPriceText(productContext);
  const offer = productContext.offer ? ` والعرض: ${productContext.offer}.` : "";

  return `الثمن هو ${price}.${offer}`;
}

export function buildGreetingReply(productContext: ProductContext): string {
  const productName = productContext.productName?.trim();

  if (!productName) {
    return "وعليكم السلام، مرحبا بيك. نقدر نعاونك فمعلومات المنتج أو التوصيل.";
  }

  const price = formatPriceText(productContext);

  if (price) {
    return `وعليكم السلام، مرحبا بيك. كنبيعو ${productName} بثمن ${price}، واش بغيتي تعرف الثمن أو التوصيل؟`;
  }

  return `وعليكم السلام، مرحبا بيك. المتوفر دابا هو ${productName}. واش بغيتي تعرف الثمن أو التوصيل؟`;
}

export function getRecommendationHints(
  productContext: ProductContext,
): string[] {
  const recommendationKeywords = [
    "مناسب",
    "عملي",
    "مطلوب",
    "زوين",
    "هدية",
    "استعمال",
    "يومي",
    "اختيار",
    "كيبان",
    "popular",
    "best",
  ];
  const possibleHints = [
    ...(productContext.recommendationNotes || []),
    ...(productContext.extraNotes || []),
    ...(productContext.features || []),
  ];

  return possibleHints.filter((hint) =>
    includesAny(hint, recommendationKeywords),
  );
}

export function buildRecommendationReply(productContext: ProductContext): string {
  const colors = productContext.availableColors?.filter(Boolean) || [];
  const recommendationHints = getRecommendationHints(productContext);

  if (recommendationHints.length) {
    const firstHint = recommendationHints[0];
    const secondHint = recommendationHints[1];

    return secondHint
      ? `إلا بغيتي رأيي، ${firstHint}. ${secondHint}.`
      : `إلا بغيتي رأيي، ${firstHint}.`;
  }

  if (colors.length) {
    const firstColor = formatColorName(colors[0]);
    const secondColor = colors[1] ? formatColorName(colors[1]) : "";

    if (secondColor) {
      return `إلا بغيتي حاجة زوينة وكتبان، ${firstColor} اختيار مزيان. وإذا بغيتي لون عملي، ${secondColor} مناسب.`;
    }

    return `إلا بغيتي رأيي، ${firstColor} اختيار مزيان.`;
  }

  const productName = productContext.productName?.trim();

  if (!productName) {
    return "نقدر نعاونك تختار حسب المعلومات المتوفرة على المنتج والتوصيل.";
  }

  const features = productContext.features?.filter(Boolean).slice(0, 2) || [];
  const price = formatPriceText(productContext);
  const details = features.length ? `، فيه ${formatNaturalList(features)}` : "";
  const secondSentence = productContext.offer
    ? `العرض: ${productContext.offer}.`
    : price
      ? `الثمن هو ${price}.`
      : "نقدر نعطيك الثمن والتوصيل إذا بغيتي.";

  return `إلا بغيتي رأيي، ${productName} اختيار مزيان${details}. ${secondSentence}`;
}

export function buildProductIdentityReply(
  productContext: ProductContext,
): string {
  const productName = productContext.productName?.trim();

  if (!productName) {
    return "نقدر نعاونك فمعلومات المنتج المتوفر عند صاحب المتجر.";
  }

  const price = formatPriceText(productContext);
  const colors = productContext.availableColors?.filter(Boolean) || [];
  const sizes = productContext.availableSizes?.filter(Boolean) || [];
  const variants = productContext.variants?.filter(Boolean) || [];
  const features = productContext.features?.filter(Boolean) || [];

  const details: string[] = [];

  if (price) {
    details.push(`بثمن ${price}`);
  }

  if (colors.length) {
    details.push(`متوفر ب${formatColorList(colors)}`);
  }

  if (sizes.length) {
    details.push(`بالمقاسات ${formatSizesSummary(sizes)}`);
  }

  if (variants.length) {
    details.push(`الأنواع: ${formatNaturalList(variants)}`);
  }

  if (features.length) {
    details.push(`فيه ${formatNaturalList(features.slice(0, 2))}`);
  }

  if (productContext.offer) {
    details.push(`العرض: ${productContext.offer}`);
  }

  if (details.length) {
    return `كنبيعو ${productName} ${details.join("، ")}.`;
  }

  if (productContext.category) {
    return `المتوفر دابا هو ${productName} من قسم ${productContext.category}. نقدر نعطيك التفاصيل اللي متوفرة.`;
  }

  if (productContext.description) {
    return `المتوفر دابا هو ${productName}: ${productContext.description}.`;
  }

  return `المتوفر دابا هو ${productName}. نقدر نعطيك التفاصيل اللي متوفرة.`;
}

export function getDeliveryPaymentReply(
  productContext: ProductContext,
): string | null {
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

export function getImageReply(productContext: ProductContext): DirectAgentResult {
  if (!productContext.images?.length) {
    return {
      reply: "الصور ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.",
      actions: [],
    };
  }

  return {
    reply: "أكيد، نقدر نرسل لك صور المنتج.",
    actions: [
      {
        type: "send_product_images",
        reason: "customer_requested_images",
        images: productContext.images,
      },
    ],
  };
}

export function getSizeReply(
  message: string,
  productContext: ProductContext,
): string {
  const availableSizes = productContext.availableSizes?.filter(Boolean) || [];
  const requestedSize = detectSpecificSize(message);

  if (!availableSizes.length) {
    return "معلومة المقاسات ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
  }

  if (requestedSize) {
    return isAvailableSize(requestedSize, productContext)
      ? `نعم، مقاس ${requestedSize} متوفر.`
      : `حالياً مقاس ${requestedSize} ما متوفرش، المقاسات المتوفرة هي: ${formatNaturalList(
          availableSizes,
        )}.`;
  }

  return `المقاسات المتوفرة هي: ${formatNaturalList(availableSizes)}.`;
}

export function getColorReply(
  message: string,
  productContext: ProductContext,
): string {
  const availableColors = productContext.availableColors?.filter(Boolean) || [];
  const requestedColor = getColorFromMessage(message);

  if (!availableColors.length) {
    return "معلومة الألوان ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
  }

  if (requestedColor) {
    return isAvailableColor(requestedColor, productContext)
      ? `نعم، اللون ${requestedColor.replyName.replace(/^ال/, "")} متوفر.`
      : `حالياً اللون ${requestedColor.replyName.replace(
          /^ال/,
          "",
        )} ما متوفرش، الألوان المتوفرة هي: ${formatColorList(
          availableColors,
        )}.`;
  }

  return `الألوان المتوفرة هي: ${formatColorList(availableColors)}.`;
}

export function getOrderReply(productContext: ProductContext): string {
  const orderFields = productContext.requiredOrderFields?.filter(Boolean);

  if (!orderFields?.length) {
    return "مرحبا، عافاك صيفط ليا الاسم الكامل، رقم الهاتف، المدينة والعنوان باش نأكد لك الطلب.";
  }

  return `مرحبا، عافاك صيفط ليا ${formatNaturalList(
    orderFields,
  )} باش نأكد لك الطلب.`;
}
