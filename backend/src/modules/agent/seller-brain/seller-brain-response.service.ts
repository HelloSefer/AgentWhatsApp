import type { AIIntentRouterAnalysis } from "../ai/ai-intent-router.service";
import {
  getColorFromMessage,
  isAvailableColor,
  isAvailableSize,
} from "../direct-answer/intent-detectors";
import {
  formatColorList,
  formatPriceText,
  formatSizesSummary,
  getDeliveryText,
  getPaymentText,
} from "../direct-answer/product-formatters";
import { formatNaturalList, includesAny } from "../direct-answer/text-normalization";
import type { ProductContext } from "../product-context.types";
import type {
  SellerBrainInput,
  SellerBrainNextStep,
  SellerBrainPlan,
  SellerBrainReplyGoal,
  SellerBrainResult,
  SellerBrainTone,
} from "./seller-brain.types";

type ReplyVariant = {
  key: string;
  text: string;
};

const forbiddenClaims = [
  "no_fake_discounts",
  "no_free_delivery_unless_known",
  "no_fake_reviews",
  "no_exact_comfort_claim",
  "no_store_address_unless_known",
  "no_best_selling_unless_known",
];

function getColors(productContext: ProductContext): string[] {
  return productContext.availableColors?.filter(Boolean) || [];
}

function getSizes(productContext: ProductContext): string[] {
  return productContext.availableSizes?.filter(Boolean) || [];
}

function getPrice(productContext: ProductContext): string {
  return formatPriceText(productContext);
}

function getOffer(productContext: ProductContext): string {
  return productContext.offer || "";
}

function hashText(text: string): number {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function pickVariant(input: SellerBrainInput, variants: ReplyVariant[]): ReplyVariant {
  const recentKeys = new Set(input.recentReplyKeys || []);
  const freshVariants = variants.filter((variant) => !recentKeys.has(variant.key));
  const choices = freshVariants.length ? freshVariants : variants;
  const hash = hashText(
    [
      input.customerId || "anonymous",
      input.message,
      input.intentAnalysis.intent,
      input.intentAnalysis.subIntent || "",
    ].join("|"),
  );

  return choices[Math.abs(hash) % choices.length];
}

function getFactsToMention(
  productContext: ProductContext,
  analysis: AIIntentRouterAnalysis,
): string[] {
  const facts: string[] = [];
  const price = getPrice(productContext);
  const colors = getColors(productContext);
  const sizes = getSizes(productContext);
  const delivery = getDeliveryText(productContext);
  const payment = getPaymentText(productContext);

  if (productContext.productName) {
    facts.push(productContext.productName);
  }

  if (price) {
    facts.push(price);
  }

  if (colors.length) {
    facts.push(formatColorList(colors));
  }

  if (sizes.length) {
    facts.push(formatSizesSummary(sizes));
  }

  if (delivery) {
    facts.push(delivery);
  }

  if (payment) {
    facts.push(payment);
  }

  if (getOffer(productContext)) {
    facts.push(getOffer(productContext));
  }

  if (analysis.entities.size) {
    facts.push(`مقاس ${analysis.entities.size}`);
  }

  if (analysis.entities.color) {
    facts.push(analysis.entities.color);
  }

  return facts;
}

function planReply(input: SellerBrainInput): SellerBrainPlan {
  const analysis = input.intentAnalysis;
  let replyGoal: SellerBrainReplyGoal = "clarify";
  let nextStep: SellerBrainNextStep = "offer_help";
  let tone: SellerBrainTone = "friendly";

  if (analysis.intent === "objection_trust") {
    replyGoal = "reassure";
    nextStep = "none";
    tone = "reassuring";
  } else if (analysis.intent === "objection_price" || analysis.intent === "negotiation") {
    replyGoal = "handle_price_objection";
    nextStep = "ask_order";
    tone = "reassuring";
  } else if (analysis.intent === "product_info_question") {
    if (
      analysis.subIntent === "recommendation_request" ||
      analysis.subIntent === "popular_color" ||
      analysis.subIntent === "comfort_question" ||
      analysis.subIntent === "usage_question" ||
      analysis.subIntent === "size_recommendation" ||
      analysis.subIntent === "fit_question"
    ) {
      replyGoal = "recommend";
      nextStep = analysis.subIntent === "popular_color" ? "ask_preference" : "ask_size";
      tone = "consultative";
    } else if (
      analysis.subIntent === "assistant_identity" ||
      analysis.subIntent === "human_check"
    ) {
      replyGoal = "answer_fact";
      nextStep = "offer_help";
      tone = "concise";
    } else {
      replyGoal = "answer_fact";
      nextStep = "offer_help";
      tone = "friendly";
    }
  } else if (
    analysis.intent === "price_question" ||
    analysis.intent === "color_question" ||
    analysis.intent === "size_question"
  ) {
    replyGoal = "answer_fact";
    nextStep = analysis.intent === "price_question" ? "ask_color" : "ask_order";
    tone = "confident";
  } else if (analysis.intent === "greeting") {
    replyGoal = "acknowledge";
    nextStep = "offer_help";
    tone = "friendly";
  }

  return {
    intent: analysis.intent,
    subIntent: analysis.subIntent,
    mood: analysis.customerMood,
    stage: analysis.salesStage,
    replyGoal,
    factsToMention: getFactsToMention(input.productContext, analysis),
    forbiddenClaims,
    nextStep,
    tone,
  };
}

function buildPriceReply(input: SellerBrainInput): ReplyVariant[] {
  const price = getPrice(input.productContext);
  const payment = getPaymentText(input.productContext);

  if (!price) {
    return [
      {
        key: "price_missing_1",
        text: "الثمن نقدر نأكدو لك من عند صاحب المتجر. نقدر نعاونك دابا فالألوان أو المقاسات المتوفرة.",
      },
    ];
  }

  return [
    {
      key: "price_1",
      text: `الثمن الحالي هو ${price}. إلا مناسبك نقدر نشوف لك اللون والمقاس.`,
    },
    {
      key: "price_2",
      text: `كاينة ب ${price}${payment ? "، و" + payment : ""}. بغيتي نكمل لك التفاصيل؟`,
    },
    {
      key: "price_3",
      text: `${price} هو الثمن ديالها دابا. نقدر نعاونك تختاري اللون والمقاس.`,
    },
  ];
}

function buildColorReply(input: SellerBrainInput): ReplyVariant[] {
  const colors = getColors(input.productContext);
  const colorText = colors.length ? formatColorList(colors) : "";
  const requestedColor = input.intentAnalysis.entities.color
    ? getColorFromMessage(input.intentAnalysis.entities.color)
    : getColorFromMessage(input.message);

  if (!colors.length) {
    return [
      {
        key: "color_missing_1",
        text: "معلومة الألوان نقدر نأكدها لك من عند صاحب المتجر.",
      },
    ];
  }

  if (!requestedColor) {
    return [
      {
        key: "color_list_1",
        text: `المتوفر دابا هو ${colorText}. الوردي كيبان أكثر لافت، والأسود عملي.`,
      },
      {
        key: "color_list_2",
        text: `كاينين ${colorText}. شنو اللون اللي قريب لك؟`,
      },
    ];
  }

  const colorName = requestedColor.replyName;
  const available = isAvailableColor(requestedColor, input.productContext);

  return available
    ? [
        {
          key: "color_available_1",
          text: `نعم، ${colorName} متوفر. بغيتي نشوف لك المقاس؟`,
        },
        {
          key: "color_available_2",
          text: `${colorName} كاين دابا. إلا مناسبك نكملو بالمقاس.`,
        },
      ]
    : [
        {
          key: "color_unavailable_1",
          text: `هاد اللون ما متوفرش حالياً، المتوفر هو ${colorText}. شنو اللون اللي قريب لك؟`,
        },
        {
          key: "color_unavailable_2",
          text: `${colorName} ما كاينش دابا. كاين ${colorText} إلا بغيتي نعاونك تختاري.`,
        },
      ];
}

function buildSizeReply(input: SellerBrainInput): ReplyVariant[] {
  const sizes = getSizes(input.productContext);
  const requestedSize = input.intentAnalysis.entities.size;

  if (!sizes.length) {
    return [
      {
        key: "size_missing_1",
        text: "معلومة المقاسات نقدر نأكدها لك من عند صاحب المتجر.",
      },
    ];
  }

  if (requestedSize) {
    return isAvailableSize(requestedSize, input.productContext)
      ? [
          {
            key: "size_available_1",
            text: `نعم، مقاس ${requestedSize} متوفر. شنو اللون اللي بغيتي؟`,
          },
          {
            key: "size_available_2",
            text: `مقاس ${requestedSize} كاين دابا. بغيتي نثبت لك اللون؟`,
          },
        ]
      : [
          {
            key: "size_unavailable_1",
            text: `مقاس ${requestedSize} ما متوفرش حالياً. المقاسات المتوفرة هي ${formatNaturalList(sizes)}.`,
          },
        ];
  }

  return [
    {
      key: "size_list_1",
      text: `المقاسات المتوفرة هي ${formatNaturalList(sizes)}. شنو المقاس ديالك؟`,
    },
  ];
}

function buildPriceObjectionReply(input: SellerBrainInput): ReplyVariant[] {
  const price = getPrice(input.productContext);
  const payment = getPaymentText(input.productContext);
  const priceText = price || "الثمن الحالي";

  if (
    input.intentAnalysis.subIntent === "price_negotiation" &&
    includesAny(input.message, ["آخر ثمن", "اخر ثمن", "akher taman", "taman akhor"])
  ) {
    return [
      {
        key: "last_price_1",
        text: `ما نقدرش نأكد تخفيض آخر دابا، ولكن الثمن الحالي ${priceText}${payment ? " و" + payment : ""}.`,
      },
    ];
  }

  return [
    {
      key: "price_objection_1",
      text: `فاهمك، الثمن مهم. الحالي هو ${priceText}${payment ? "، والميزة أنك كتخلصي حتى توصلك السلعة" : ""}. إلا مناسبك نثبت لك اللون والمقاس.`,
    },
    {
      key: "price_objection_2",
      text: `عندك الحق تقارني. الثمن دابا ${priceText}${payment ? " و" + payment : ""}.`,
    },
    {
      key: "price_objection_3",
      text: `ماشي مشكل، ${priceText} هو الثمن الحالي. نقدر نوضح لك الألوان والمقاسات قبل ما تقرري.`,
    },
  ];
}

function buildTrustReply(): ReplyVariant[] {
  return [
    {
      key: "trust_1",
      text: "عندك الحق تسولي. باش ترتاحي، الدفع كاين حتى توصلك السلعة، وغادي نأكدو معاك التفاصيل قبل الإرسال.",
    },
    {
      key: "trust_2",
      text: "طبيعي تسولي على الثقة. الأداء عند الاستلام، والطلب كيتأكد معاك قبل الإرسال.",
    },
  ];
}

function buildRecommendationReply(input: SellerBrainInput): ReplyVariant[] {
  if (input.intentAnalysis.subIntent === "popular_color") {
    return [
      {
        key: "popular_color_1",
        text: "ما عنديش إحصائية مؤكدة على الأكثر طلباً، ولكن الوردي كيبان لافت، والأسود عملي وكيناسب بزاف ديال اللبسات.",
      },
      {
        key: "popular_color_2",
        text: "ما نقدرش نقول الأكثر مبيعاً بلا إحصائية. الوردي كيبان زوين، والأسود اختيار عملي.",
      },
    ];
  }

  return [
    {
      key: "recommend_1",
      text: "إلا بغيتي لون باين ولطيف، الوردي اختيار مزيان. إلا بغيتي حاجة عملية مع اللباس كامل، الأسود أحسن.",
    },
    {
      key: "recommend_2",
      text: "الوردي كيعطي لوك باين، والأسود كلاسيكي وسهل يتلبس مع بزاف ديال الحوايج.",
    },
    {
      key: "recommend_3",
      text: "إلى كنتي محتارة، اختاري حسب الستايل ديالك: الوردي باين ولطيف، والأسود عملي وكلاسيكي.",
    },
  ];
}

function buildProductInfoReply(input: SellerBrainInput): ReplyVariant[] {
  const subIntent = input.intentAnalysis.subIntent;
  const price = getPrice(input.productContext);
  const colors = getColors(input.productContext);
  const sizes = getSizes(input.productContext);

  if (subIntent === "comfort_question") {
    return [
      {
        key: "comfort_1",
        text: "معلومة الراحة بالتفصيل نقدر نأكدها لك، ولكن نقدر نعاونك تختاري المقاس المناسب باش تكوني مرتاحة أكثر.",
      },
    ];
  }

  if (subIntent === "size_recommendation" || subIntent === "fit_question") {
    return [
      {
        key: "fit_1",
        text: "إلا رجلك شوية عريضة، نقدر نأكد لك المقاس الأنسب من عند صاحب المتجر. عطيني المقاس اللي كتلبسي عادة ونعاونك نختاري.",
      },
      {
        key: "fit_2",
        text: "باش ما نعطيكش نصيحة ناقصة، عطيني المقاس اللي كتلبسي عادة ونأكد لك الأنسب. نقدر حتى نراجعها مع صاحب المتجر.",
      },
      {
        key: "fit_3",
        text: "فحالة الرجل العريضة الأحسن نأكدو المقاس قبل الطلب. قولي لي شنو المقاس اللي كتلبسي غالباً ونعاونك.",
      },
    ];
  }

  if (subIntent === "usage_question") {
    return [
      {
        key: "usage_1",
        text: "للخروج تقدر تكون اختيار زوين، خصوصاً الوردي إلا بغيتي لون باين، والأسود إلا بغيتي حاجة كلاسيكية.",
      },
      {
        key: "usage_2",
        text: "إيه تقدر تناسب الخروج. الوردي كيبان أكثر، والأسود عملي وسهل يتلبس مع بزاف ديال الحوايج.",
      },
    ];
  }

  if (subIntent === "store_location") {
    const storeAddress =
      input.productContext.attributes?.storeLocation ||
      input.productContext.attributes?.["store_location"];

    return [
      {
        key: "store_1",
        text: storeAddress
          ? `تقدري تشوفيها ف${storeAddress}.`
          : "عنوان المحل ما متوفرش عندي دابا، ولكن التوصيل متوفر ونقدر نكمل معاك الطلب هنا.",
      },
    ];
  }

  if (subIntent === "assistant_identity" || subIntent === "human_check") {
    return [
      {
        key: "identity_1",
        text: "أنا مساعد المتجر، كنعاونك فمعلومات المنتج وتأكيد الطلب بسرعة.",
      },
      {
        key: "identity_2",
        text: "أنا مساعد المتجر، نقدر نوضح لك الثمن، الألوان، المقاسات والتوصيل.",
      },
    ];
  }

  if (subIntent === "product_overview") {
    return [
      {
        key: "overview_1",
        text: `عندنا ${input.productContext.productName}${price ? " ب " + price : ""}${colors.length ? "، كاينة ب" + formatColorList(colors) : ""}.`,
      },
      {
        key: "overview_2",
        text: `${input.productContext.productName} متوفرة دابا${sizes.length ? " بالمقاسات " + formatSizesSummary(sizes) : ""}. إلا بغيتي نوضح لك الثمن أو الألوان أنا معاك.`,
      },
    ];
  }

  return buildRecommendationReply(input);
}

function buildAcknowledgementReply(input: SellerBrainInput): ReplyVariant[] {
  const message = input.message.trim().toLowerCase();

  if (message === "merci" || message === "شكرا") {
    return [{ key: "ack_merci_1", text: "العفو، مرحبا بك." }];
  }

  if (message === "ok" || message === "okay") {
    return [{ key: "ack_ok_1", text: "تمام، أنا معاك." }];
  }

  if (message === "hmm" || message === "hm") {
    return [
      {
        key: "ack_hmm_1",
        text: "خدي راحتك، إلا بغيتي نوضح لك شي حاجة أنا معاك.",
      },
    ];
  }

  return [{ key: "ack_1", text: "مرحبا بك، كيف نقدر نعاونك؟" }];
}

function buildUnknownReply(): ReplyVariant[] {
  return [
    {
      key: "unknown_1",
      text: "ما فهمتش عليك مزيان، واش بغيتي تعرفي الثمن، الألوان، المقاس ولا بغيتي تطلبي؟",
    },
    {
      key: "unknown_2",
      text: "نوضح لك أكثر؟ قولي لي واش بغيتي الثمن، اللون، المقاس ولا الطلب.",
    },
  ];
}

function getVariants(input: SellerBrainInput): ReplyVariant[] {
  const intent = input.intentAnalysis.intent;

  if (intent === "unknown") {
    const normalized = input.message.trim().toLowerCase();

    if (["hmm", "hm", "ok", "okay", "merci"].includes(normalized)) {
      return buildAcknowledgementReply(input);
    }
  }

  if (intent === "price_question") {
    return buildPriceReply(input);
  }

  if (intent === "color_question") {
    return buildColorReply(input);
  }

  if (intent === "size_question") {
    return buildSizeReply(input);
  }

  if (intent === "objection_price" || intent === "negotiation") {
    return buildPriceObjectionReply(input);
  }

  if (intent === "objection_trust") {
    return buildTrustReply();
  }

  if (intent === "product_info_question") {
    return buildProductInfoReply(input);
  }

  if (intent === "greeting") {
    return buildAcknowledgementReply(input);
  }

  return buildUnknownReply();
}

export function canSellerBrainHandle(analysis: AIIntentRouterAnalysis): boolean {
  if (
    analysis.intent === "price_question" ||
    analysis.intent === "color_question" ||
    analysis.intent === "size_question" ||
    analysis.intent === "objection_price" ||
    analysis.intent === "negotiation" ||
    analysis.intent === "objection_trust" ||
    analysis.intent === "greeting" ||
    analysis.intent === "unknown"
  ) {
    return true;
  }

  return (
    analysis.intent === "product_info_question" &&
    [
      "recommendation_request",
      "popular_color",
      "comfort_question",
      "usage_question",
      "store_location",
      "assistant_identity",
      "human_check",
      "product_overview",
      "size_recommendation",
      "fit_question",
    ].includes(analysis.subIntent || "")
  );
}

export function buildSellerBrainResponse(input: SellerBrainInput): SellerBrainResult {
  const plan = planReply(input);
  const variant = pickVariant(input, getVariants(input));

  return {
    reply: variant.text,
    replyKey: variant.key,
    plan,
    source: "seller_brain",
  };
}
