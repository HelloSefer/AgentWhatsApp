import type { AgentAction } from "../agent-action.types";
import type { AIIntentRouterAnalysis } from "../ai/ai-intent-router.service";
import {
  getImageReply,
  getSizeReply,
} from "../direct-answer/reply-builders";
import {
  formatColorList,
  formatPriceText,
  formatSizesSummary,
  getDeliveryText,
  getPaymentText,
} from "../direct-answer/product-formatters";
import { getColorFromMessage } from "../direct-answer/intent-detectors";
import {
  formatNaturalList,
  includesAny,
  normalizeComparable,
} from "../direct-answer/text-normalization";
import type { ProductContext } from "../product-context.types";

export const OLD_GENERIC_FALLBACK_REPLY =
  "نقدر نعاونك فالثمن، التوصيل، الألوان، المقاسات أو الطلب.";

export type SalesResponseInput = {
  message: string;
  productContext: ProductContext;
  analysis: AIIntentRouterAnalysis;
  customerId?: string;
};

export type SalesResponseResult = {
  reply: string;
  actions: AgentAction[];
};

function hashText(text: string): number {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function pickVariant(input: SalesResponseInput, variants: string[]): string {
  const key = [
    input.customerId || "anonymous",
    input.message,
    input.analysis.intent,
    input.analysis.subIntent || "",
  ].join("|");

  return variants[hashText(key) % variants.length];
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (reply, [key, value]) => reply.split(`{${key}}`).join(value),
    template,
  );
}

function getAvailableColors(productContext: ProductContext): string[] {
  return productContext.availableColors?.filter(Boolean) || [];
}

function getAvailableSizes(productContext: ProductContext): string[] {
  return productContext.availableSizes?.filter(Boolean) || [];
}

function getPriceText(productContext: ProductContext): string {
  return formatPriceText(productContext) || "الثمن ما متوفرش عندي دابا";
}

function getOfferText(productContext: ProductContext): string {
  return productContext.offer ? `، و${productContext.offer} دابا` : "";
}

function hasAvailableColor(productContext: ProductContext, color: string): boolean {
  return getAvailableColors(productContext).some(
    (availableColor) =>
      normalizeComparable(availableColor) === normalizeComparable(color),
  );
}

function isShortAcknowledgement(message: string): boolean {
  return ["hmm", "hm", "ok", "okay", "واخا", "تمام"].some(
    (value) => message.trim().toLowerCase() === value,
  );
}

function buildAcknowledgementReply(input: SalesResponseInput): string {
  const normalizedMessage = input.message.trim().toLowerCase();

  if (normalizedMessage === "hmm" || normalizedMessage === "hm") {
    return pickVariant(input, [
      "إلى بغيتي نوضح لك شي حاجة، أنا معاك.",
      "خدي راحتك، نقدر نوضح لك الثمن، اللون ولا المقاس.",
      "ماشي مشكل، إلى بغيتي شي توضيح قولي لي.",
    ]);
  }

  if (normalizedMessage === "ok" || normalizedMessage === "okay") {
    return pickVariant(input, [
      "تمام، أنا معاك.",
      "واخا، إلا بغيتي شي معلومة قولي لي.",
      "مزيان، نقدر نعاونك فاش بغيتي تعرف.",
    ]);
  }

  return pickVariant(input, [
    "العفو، مرحبا بك.",
    "مرحبا بك، أي سؤال أنا معاك.",
    "العفو، إلى بغيتي شي معلومة قولي لي.",
  ]);
}

function buildPriceReply(input: SalesResponseInput): string {
  const price = getPriceText(input.productContext);
  const offer = getOfferText(input.productContext);

  if (!input.productContext.price) {
    return "الثمن ما متوفرش عندي دابا، نقدر نأكدو لك من عند صاحب المتجر.";
  }

  return fillTemplate(
    pickVariant(input, [
      "الثمن {price}{offer}. بغيتي نشوف لك المقاس واللون؟",
      "كاينة ب {price}. إلى عجباتك نقدر نعاونك تختاري اللون والمقاس.",
      "الثمن هو {price}{offer}. واش بغيتي تعرفي الألوان المتوفرة؟",
      "{price} هو الثمن ديالها{offer}. نقدر نكمل معاك التفاصيل إلا بغيتي.",
    ]),
    { price, offer },
  );
}

function buildColorReply(input: SalesResponseInput): string {
  const colors = getAvailableColors(input.productContext);
  const colorsText = colors.length ? formatColorList(colors) : "";
  const requestedColor = input.analysis.entities.color
    ? getColorFromMessage(input.analysis.entities.color)
    : getColorFromMessage(input.message);

  if (!colors.length) {
    return "معلومة الألوان ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
  }

  if (!requestedColor) {
    return fillTemplate(
      pickVariant(input, [
        "المتوفر دابا هو {colors}. شنو اللون اللي عجبك؟",
        "كاينين هاد الألوان: {colors}. بغيتي نعاونك تختاري؟",
        "الألوان المتوفرة هي: {colors}. شنو اللون اللي بغيتي؟",
      ]),
      { colors: colorsText },
    );
  }

  const isAvailable = colors.some((color) =>
    requestedColor.values.some(
      (value) => normalizeComparable(value) === normalizeComparable(color),
    ),
  );
  const colorName = requestedColor.replyName;

  if (isAvailable) {
    return fillTemplate(
      pickVariant(input, [
        "نعم، اللون {color} متوفر. بغيتي نشوف لك المقاس؟",
        "{color} كاين دابا. شنو المقاس اللي بغيتي؟",
        "إيه، {color} متوفر. نقدر نكمل معاك الطلب إلا بغيتي.",
      ]),
      { color: colorName.replace(/^ال/, "") },
    );
  }

  return fillTemplate(
    pickVariant(input, [
      "اللون {color} ما متوفرش حالياً، ولكن كاين {colors}. بغيتي نرشح لك واحد فيهم؟",
      "{color} ما كاينش دابا. المتوفر هو {colors}.",
      "حالياً {color} ما متوفرش، كاين {colors}. شنو اللون اللي مناسبك؟",
    ]),
    { color: colorName, colors: colorsText },
  );
}

function buildSizeReply(input: SalesResponseInput): string {
  const sizes = getAvailableSizes(input.productContext);

  if (!sizes.length) {
    return "معلومة المقاسات ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
  }

  if (input.analysis.entities.size) {
    return getSizeReply(`مقاس ${input.analysis.entities.size}`, input.productContext);
  }

  return fillTemplate(
    pickVariant(input, [
      "المقاسات المتوفرة هي {sizes}. شنو المقاس ديالك؟",
      "كاينين المقاسات {sizes}. قولي لي شنو بغيتي.",
      "المتوفر دابا فالمقاسات هو {sizes}.",
    ]),
    { sizes: formatNaturalList(sizes) },
  );
}

function buildDeliveryReply(input: SalesResponseInput): string {
  const deliveryText = getDeliveryText(input.productContext);
  const deliveryCost =
    input.productContext.attributes?.deliveryCost ||
    input.productContext.attributes?.["delivery_cost"] ||
    input.productContext.attributes?.["ثمن التوصيل"] ||
    input.productContext.attributes?.["تمن التوصيل"];

  if (input.analysis.subIntent === "delivery_cost") {
    if (deliveryCost) {
      return `ثمن التوصيل هو ${deliveryCost}.`;
    }

    return deliveryText
      ? `${deliveryText}، وثمن التوصيل نقدر نأكدو لك من عند صاحب المتجر.`
      : "ثمن التوصيل نقدر نأكدو لك من عند صاحب المتجر.";
  }

  return deliveryText
    ? fillTemplate(
        pickVariant(input, [
          "{delivery}.",
          "نعم، {delivery}.",
          "{delivery}، ونقدر نعاونك نكملو الطلب إلا بغيتي.",
        ]),
        { delivery: deliveryText },
      )
    : "معلومة التوصيل ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
}

function buildPaymentReply(input: SalesResponseInput): string {
  const paymentText = getPaymentText(input.productContext);

  return paymentText
    ? fillTemplate(
        pickVariant(input, [
          "{payment}.",
          "نعم، {payment}.",
          "{payment} باش ترتاحي حتى توصلك السلعة.",
        ]),
        { payment: paymentText },
      )
    : "معلومة الدفع ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
}

function buildProductOverviewReply(input: SalesResponseInput): string {
  const productName = input.productContext.productName?.trim();

  if (!productName) {
    return "نقدر نعاونك فمعلومات المنتج المتوفر عند صاحب المتجر.";
  }

  const price = formatPriceText(input.productContext);
  const colors = getAvailableColors(input.productContext);
  const sizes = getAvailableSizes(input.productContext);
  const deliveryText = getDeliveryText(input.productContext);
  const paymentText = getPaymentText(input.productContext);
  const pricePart = price ? ` ب ${price}` : "";
  const colorsPart = colors.length ? `، كاينة ب${formatColorList(colors)}` : "";
  const sizesPart = sizes.length ? `، والمقاسات ${formatSizesSummary(sizes)}` : "";
  const deliveryPaymentPart =
    deliveryText && paymentText
      ? `${deliveryText} و${paymentText}`
      : [deliveryText, paymentText].filter(Boolean).join(" و");

  if (
    includesAny(input.message, [
      "شنو كتبيعو",
      "شنو كتبيع",
      "اش كتبيعو",
      "كتبيعو شنو",
      "xno katbi3o",
      "chno katbi3o",
      "what do you sell",
    ])
  ) {
    return fillTemplate(
      pickVariant(input, [
        "كنبيعو {product}{price}{colors}{sizes}. {support}.",
        "المتوفر دابا هو {product}{price}{colors}. بغيتي نعطيك التفاصيل ديال المقاسات؟",
        "{product} هي المنتوج المتوفر دابا{colors}. الثمن {priceOnly} ونقدر نعاونك فالطلب.",
      ]),
      {
        product: productName,
        price: pricePart,
        priceOnly: price || "ما متوفرش عندي دابا",
        colors: colorsPart,
        sizes: sizesPart,
        support: deliveryPaymentPart || "نقدر نعطيك التفاصيل المتوفرة",
      },
    ).trim();
  }

  return fillTemplate(
    pickVariant(input, [
      "المنتوج هو {product}، الثمن ديالو {priceOnly}{colors}. بغيتي نشوف لك المقاس؟",
      "عندنا {product}{colors}. الثمن {priceOnly}{paymentShort}.",
      "{product} متوفرة دابا{colors}{sizes}. إلى عجباتك نعاونك تختاري اللون والمقاس.",
      "هاد المنتوج هو {product}{price}{colors}. {support}.",
    ]),
    {
      product: productName,
      price: pricePart,
      priceOnly: price || "ما متوفرش عندي دابا",
      paymentShort: paymentText ? " والدفع حتى توصلك" : "",
      colors: colorsPart,
      sizes: sizesPart,
      support: deliveryPaymentPart || "نقدر نعطيك التفاصيل المتوفرة",
    },
  ).trim();
}

function buildPriceObjectionReply(input: SalesResponseInput): string {
  const price = formatPriceText(input.productContext);
  const paymentText = getPaymentText(input.productContext);

  if (!price) {
    return "فاهمك، الثمن ما متوفرش عندي دابا، نقدر نأكدو لك من عند صاحب المتجر.";
  }

  if (
    input.analysis.subIntent === "price_negotiation" &&
    includesAny(input.message, ["آخر ثمن", "اخر ثمن", "akher taman", "taman akhor"])
  ) {
    return `الثمن الحالي هو ${price}. ما عنديش تخفيض آخر مؤكد دابا، ولكن نقدر نثبت لك اللون والمقاس إلا مناسبك.`;
  }

  if (paymentText) {
    return fillTemplate(
      pickVariant(input, [
        "فاهمك، الثمن مهم. هادي ب {price} والميزة أن الدفع حتى توصلك السلعة. إذا عجباتك نقدر نثبت لك اللون والمقاس.",
        "عندك الحق تقارني الثمن. الثمن هو {price}، و{payment}. نقدر نعاونك تختاري قبل ما تأكدي الطلب.",
        "ماشي مشكل، {price} هو الثمن ديالها، و{payment} باش ترتاحي. بغيتي نشوف لك اللون والمقاس؟",
      ]),
      { price, payment: paymentText },
    );
  }

  return fillTemplate(
    pickVariant(input, [
      "فاهمك، الثمن هو {price}. نقدر نوضح لك التفاصيل المتوفرة باش تقرري براحتك.",
      "الثمن {price}. إلا عجباتك نعاونك فاللون والمقاس.",
      "ماشي مشكل، {price} هو الثمن ديالها. بغيتي تعرفي شنو متوفر؟",
    ]),
    { price },
  );
}

function buildTrustReply(input: SalesResponseInput): string {
  const paymentText = getPaymentText(input.productContext);

  if (includesAny(input.message, ["نصابة", "نصاب", "nasaba", "scam"])) {
    return paymentText
      ? "عندك الحق تسولي. باش ترتاحي، الدفع كاين حتى توصلك السلعة، وغادي نأكدو معاك التفاصيل قبل الإرسال."
      : "عندك الحق تسولي. نقدر نأكد لك التفاصيل المتوفرة من عند صاحب المتجر قبل ما تقرري.";
  }

  if (input.analysis.subIntent === "social_proof_request") {
    return paymentText
      ? "آراء الزبناء ما متوفراش عندي دابا، ولكن الدفع كاين حتى توصلك السلعة باش ترتاحي قبل ما تخلصي."
      : "آراء الزبناء ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر.";
  }

  return paymentText
    ? fillTemplate(
        pickVariant(input, [
          "عندك الحق تسولي. الأداء كاين حتى توصلك السلعة، ومن بعد كنأكدو معاك التفاصيل قبل الإرسال. بغيتي نكمل لك المعلومات؟",
          "طبيعي تسولي على الثقة. {payment} وغادي يتأكد الطلب معاك قبل الإرسال.",
          "باش ترتاحي، {payment}. ونقدر نوضح لك أي معلومة قبل ما تأكدي الطلب.",
        ]),
        { payment: paymentText },
      )
    : "عندك الحق تسولي. نقدر نأكد لك معلومات الثقة والتوصيل من عند صاحب المتجر.";
}

function findContextHint(productContext: ProductContext, keywords: string[]): string | undefined {
  const candidates = [
    productContext.description,
    ...(productContext.features || []),
    ...(productContext.extraNotes || []),
  ].filter((value): value is string => Boolean(value?.trim()));

  return candidates.find((candidate) => includesAny(candidate, keywords));
}

function buildProductInfoReply(input: SalesResponseInput): string {
  if (input.analysis.subIntent === "assistant_identity") {
    return pickVariant(input, [
      "أنا مساعد المتجر، كنعاونك فمعلومات المنتج وتأكيد الطلب بسرعة.",
      "أنا مساعد المتجر، نقدر نعاونك فالثمن، الألوان، المقاسات والتوصيل.",
      "أنا هنا باش نعاونك تختاري ونأكد لك الطلب إلا بغيتي.",
    ]);
  }

  if (input.analysis.subIntent === "human_check") {
    return pickVariant(input, [
      "أنا مساعد ذكي ديال المتجر، كنعاونك بسرعة فمعلومات المنتج والطلب.",
      "أنا مساعد المتجر ماشي إنسان، ولكن نقدر نعاونك فالمعلومات والطلب بسرعة.",
      "أنا مساعد ذكي، كنوضح لك الثمن، الألوان، المقاسات والتوصيل.",
    ]);
  }

  if (input.analysis.subIntent === "product_overview") {
    return buildProductOverviewReply(input);
  }

  if (input.analysis.subIntent === "popular_color") {
    if (
      hasAvailableColor(input.productContext, "وردي") &&
      hasAvailableColor(input.productContext, "أسود")
    ) {
      return "ما عنديش إحصائية مؤكدة على الأكثر طلباً، ولكن الوردي كيبان أكثر لافت، والأسود عملي وكيناسب بزاف ديال اللبسات.";
    }

    const colors = getAvailableColors(input.productContext);

    return colors.length
      ? `ما عنديش إحصائية مؤكدة على الأكثر طلباً، ولكن المتوفر دابا هو ${formatColorList(colors)}.`
      : "ما عنديش إحصائية مؤكدة على الأكثر طلباً دابا.";
  }

  if (input.analysis.subIntent === "recommendation_request") {
    if (
      hasAvailableColor(input.productContext, "وردي") &&
      hasAvailableColor(input.productContext, "أسود")
    ) {
      return pickVariant(input, [
        "إلا بغيتي حاجة باينة وزوينة، الوردي اختيار مزيان. إلا بغيتي حاجة عملية مع اللباس كامل، الأسود أحسن.",
        "الوردي كيعطي لوك باين ولطيف، والأسود عملي وكيناسب بزاف ديال اللبسات. شنو الستايل اللي قريب لك؟",
        "أنا نرشح الوردي إلا بغيتي اللون يبان، والأسود إلا بغيتي حاجة كلاسيكية وسهلة فاللباس.",
      ]);
    }

    const notes = input.productContext.recommendationNotes?.filter(Boolean) || [];

    if (notes.length) {
      return fillTemplate(
        pickVariant(input, [
          "إلى بغيتي رأيي، {note}. بغيتي نشوف لك اللون والمقاس؟",
          "{note}. نقدر نعاونك تختاري حسب اللون اللي كيعجبك.",
          "نرشح لك حسب اللي بغيتي، و{note}.",
        ]),
        { note: notes[0] },
      );
    }

    return "نقدر نعاونك تختاري حسب اللون والمقاس المتوفر. شنو كيعجبك أكثر؟";
  }

  if (input.analysis.subIntent === "comfort_question") {
    const comfortHint = findContextHint(input.productContext, [
      "مريح",
      "مريحة",
      "راحة",
      "comfortable",
      "comfort",
      "confort",
    ]);

    return comfortHint
      ? `${comfortHint}.`
      : "معلومة الراحة بالتفصيل نقدر نأكدها لك، ولكن نقدر نساعدك دابا تختاري المقاس المناسب باش تكوني مرتاحة أكثر.";
  }

  if (input.analysis.subIntent === "usage_question") {
    const usageHint = findContextHint(input.productContext, [
      "خروج",
      "استعمال",
      "يومي",
      "مناسب",
      "usage",
      "use",
    ]);

    return usageHint
      ? `${usageHint}.`
      : "للخروج تقدر تكون اختيار زوين خصوصاً الوردي إلا بغيتي لون باين، والأسود إلا بغيتي حاجة كلاسيكية. بغيتي نشوف لك المقاس؟";
  }

  if (input.analysis.subIntent === "store_location") {
    const storeLocation =
      input.productContext.attributes?.storeLocation ||
      input.productContext.attributes?.["store_location"] ||
      input.productContext.attributes?.["عنوان المحل"] ||
      input.productContext.attributes?.["المحل"];

    return storeLocation
      ? `تقدر تشوفها ف${storeLocation}.`
      : "عنوان المحل ما متوفرش عندي دابا، ولكن التوصيل متوفر ونقدر نكمل معاك الطلب هنا.";
  }

  if (input.analysis.subIntent === "size_recommendation") {
    return "باش نعاونك فالمقاس، قولي ليا شحال كتلبسي عادة وواش رجلك كتجي عريضة بزاف.";
  }

  return buildProductOverviewReply(input);
}

function buildUnknownReply(input: SalesResponseInput): string {
  if (isShortAcknowledgement(input.message)) {
    return buildAcknowledgementReply(input);
  }

  return pickVariant(input, [
    "ماشي مشكل، قولي لي شنو بغيتي تعرفي على المنتج.",
    "نقدر نعاونك حسب اللي محتاجة تعرفي: الثمن، اللون، المقاس أو التوصيل.",
    "إلى بغيتي نوضح لك شي حاجة على المنتج، أنا معاك.",
  ]);
}

export function buildSalesResponse(input: SalesResponseInput): SalesResponseResult {
  switch (input.analysis.intent) {
    case "price_question":
      return { reply: buildPriceReply(input), actions: [] };

    case "size_question":
      return { reply: buildSizeReply(input), actions: [] };

    case "color_question":
      return { reply: buildColorReply(input), actions: [] };

    case "delivery_question":
      return { reply: buildDeliveryReply(input), actions: [] };

    case "payment_question":
      return { reply: buildPaymentReply(input), actions: [] };

    case "image_request": {
      const imageReply = getImageReply(input.productContext);
      return { reply: imageReply.reply, actions: imageReply.actions ?? [] };
    }

    case "objection_price":
    case "negotiation":
      return { reply: buildPriceObjectionReply(input), actions: [] };

    case "objection_trust":
      return { reply: buildTrustReply(input), actions: [] };

    case "product_info_question":
      return { reply: buildProductInfoReply(input), actions: [] };

    case "greeting":
      return input.analysis.subIntent === "acknowledgement"
        ? { reply: buildAcknowledgementReply(input), actions: [] }
        : {
            reply: pickVariant(input, [
              "وعليكم السلام، مرحبا بك. كيف نقدر نعاونك؟",
              "سلام، مرحبا بك. نقدر نوضح لك الثمن، الألوان أو التوصيل.",
              "وعليكم السلام. شنو بغيتي تعرف على المنتج؟",
            ]),
            actions: [],
          };

    case "objection_delivery":
      return {
        reply: `${buildDeliveryReply(input)} إذا عندك تخوف من التوصيل نقدر نوضح لك المعلومات المتوفرة.`,
        actions: [],
      };

    case "order_confirmation":
      return {
        reply: "مازال خاصني معلومات الطلب باش نقدر نأكدو لك.",
        actions: [],
      };

    case "order_correction":
      return {
        reply: "ما عنديش طلب مفتوح للتعديل دابا. إلا بغيتي تطلب، صيفط ليا معلومات الطلب.",
        actions: [],
      };

    case "unknown":
    case "unrelated":
    case "complaint":
    default:
      return { reply: buildUnknownReply(input), actions: [] };
  }
}
