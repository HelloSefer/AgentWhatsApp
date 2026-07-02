import type { ProductContext, ProductImage } from "./product-context.types";

type AgentIntent =
  | "price_question"
  | "delivery_payment_question"
  | "color_question"
  | "size_question"
  | "order_intent"
  | "unavailable_product_question"
  | "price_objection"
  | "image_request"
  | "product_attribute_question"
  | "off_topic"
  | "general_product_question"
  | "unknown";

const intentReplyFocus: Record<AgentIntent, string> = {
  price_question:
    "جاوب على الثمن من Product context فقط، وممكن تذكر التوصيل أو الدفع باختصار إلا كانو متوفرين.",
  delivery_payment_question:
    "جاوب غير على التوصيل والدفع من Product context. ما تطلبش معلومات الطلب ولا اللون ولا المقاس إلا كان الزبون باغي يكوموندي بوضوح.",
  color_question:
    "جاوب على الألوان المتوفرة أو غير المتوفرة من Product context فقط. إلا ما كايناش الألوان، قول غادي تأكدها.",
  size_question:
    "جاوب على المقاسات المتوفرة من Product context فقط. إلا ما كايناش المقاسات، قول غادي تأكدها.",
  order_intent:
    "طلب معلومات الطلب الموجودة ف requiredOrderFields بطريقة طبيعية، وما تطلبش حقول ما مذكوراش.",
  unavailable_product_question:
    "إلا كان الزبون سول على منتوج مختلف من المنتوج الحالي، قول بلطف أنه ما متوفرش واقترح المنتوج الحالي من Product context.",
  price_objection:
    "تقبل اعتراض الثمن بلطف، وذكر الثمن أو الدفع أو العرض إلا كانو متوفرين. ما تذكرش الجودة إلا كانت ف features أو attributes أو extraNotes.",
  image_request:
    "جاوب على طلب الصور فقط. إلا كانت الصور متوفرة قول يمكن يتصيفطو، بلا ما تدعي أنك صيفطتيهم وبلا ذكر لون محدد إلا طلبو الزبون.",
  product_attribute_question:
    "جاوب على الخاصية المطلوبة فقط إذا كانت موجودة ف Product context. إلا ما كانتش، قول المعلومة ما متوفراش دابا وتقدر تأكدها من عند صاحب المتجر.",
  off_topic:
    "جاوب بخفة بلا كلمات غريبة، ورجع الحوار للمنتوج الحالي أو التوصيل.",
  general_product_question:
    "جاوب على المنتوج الحالي باستعمال غير المعلومات الموجودة ف Product context.",
  unknown: "طلب توضيح بسيط مرتبط بالمنتوج الحالي أو التوصيل.",
};

function includesAny(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => message.includes(keyword));
}

function compactList(items?: string[]): string {
  return items?.filter(Boolean).join("، ") || "";
}

function formatPrice(productContext: ProductContext): string {
  if (!productContext.price) {
    return "";
  }

  return [productContext.price, productContext.currency].filter(Boolean).join(" ");
}

function formatAttributes(attributes?: Record<string, string>): string {
  if (!attributes) {
    return "";
  }

  return Object.entries(attributes)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join("، ");
}

function formatFaqs(faqs?: Array<{ question: string; answer: string }>): string {
  if (!faqs?.length) {
    return "";
  }

  return faqs
    .filter((faq) => faq.question && faq.answer)
    .map((faq) => `${faq.question}: ${faq.answer}`)
    .join("، ");
}

function formatImages(images?: ProductImage[]): string {
  if (!images?.length) {
    return "غير متوفرة فالسياق الحالي";
  }

  return `متوفرة (${images.length})`;
}

function buildProductKnowledge(productContext: ProductContext): string {
  const lines = [
    `- اسم المتجر: ${productContext.businessName}`,
    `- المنتوج الحالي: ${productContext.productName}`,
  ];

  const optionalFields: Array<[string, string | undefined]> = [
    ["الصنف", productContext.category],
    ["الوصف", productContext.description],
    ["الثمن", formatPrice(productContext)],
    ["الألوان", compactList(productContext.availableColors)],
    ["المقاسات", compactList(productContext.availableSizes)],
    ["الأنواع/الفاريونت", compactList(productContext.variants)],
    ["المميزات", compactList(productContext.features)],
    ["خصائص إضافية", formatAttributes(productContext.attributes)],
    ["أسئلة وأجوبة", formatFaqs(productContext.faqs)],
    ["التوصيل", productContext.deliveryInfo],
    ["مناطق التوصيل", compactList(productContext.deliveryAreas)],
    ["مدة التوصيل", productContext.deliveryTime],
    ["طرق الدفع", compactList(productContext.paymentMethods)],
    ["العرض", productContext.offer],
    ["المخزون", productContext.stockInfo],
    ["الضمان", productContext.warrantyInfo],
    ["الحالة", productContext.condition],
    ["منتجات غير متوفرة", compactList(productContext.unavailableProducts)],
    ["ملاحظات إضافية", compactList(productContext.extraNotes)],
  ];

  for (const [label, value] of optionalFields) {
    if (value) {
      lines.push(`- ${label}: ${value}`);
    }
  }

  lines.push(`- الصور: ${formatImages(productContext.images)}`);

  return lines.join("\n");
}

function buildOrderFields(productContext: ProductContext): string {
  const fields = compactList(productContext.requiredOrderFields);

  return fields || "ما كايناش حقول طلب محددة فالسياق الحالي";
}

function mentionsCurrentProduct(
  message: string,
  productContext?: ProductContext,
): boolean {
  if (!productContext) {
    return false;
  }

  const contextText = [
    productContext.productName,
    productContext.category,
    ...(productContext.variants || []),
  ]
    .join(" ")
    .toLowerCase();

  const contextTokens = contextText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

  return contextTokens.some((token) => message.includes(token));
}

function inferRequestedAttribute(userMessage: string): string | undefined {
  const message = userMessage.trim().toLowerCase();

  if (includesAny(message, ["كيبقى", "تبقى", "يبقى", "ثبات", "ثابت", "مدة طويلة"])) {
    return "الثبات";
  }

  if (includesAny(message, ["بطارية", "البطارية", "باطري", "battery"])) {
    return "البطارية";
  }

  if (includesAny(message, ["أصلي", "اصلي", "أصلية", "اصلية", "original", "authentic"])) {
    return "الأصالة";
  }

  if (includesAny(message, ["المادة", "مادة", "الثوب", "خام", "fabric", "material"])) {
    return "المادة";
  }

  if (includesAny(message, ["ضمان", "garantie", "warranty"])) {
    return "الضمان";
  }

  if (includesAny(message, ["جديد", "مستعمل", "الحالة", "حالة", "condition"])) {
    return "الحالة";
  }

  if (includesAny(message, ["رام", "ram"])) {
    return "الرام";
  }

  if (includesAny(message, ["ذاكرة", "مساحة", "ستوكاج", "stockage", "storage"])) {
    return "التخزين";
  }

  return undefined;
}

function getAttributeAliases(attributeName: string): string[] {
  const aliases: Record<string, string[]> = {
    الثبات: ["الثبات", "ثبات", "كيبقى", "تبقى", "يبقى", "مدة طويلة"],
    البطارية: ["البطارية", "بطارية", "باطري", "battery"],
    الأصالة: ["الأصالة", "اصلي", "أصلي", "أصلية", "اصلية", "original", "authentic"],
    المادة: ["المادة", "مادة", "الثوب", "خام", "fabric", "material"],
    الضمان: ["الضمان", "ضمان", "garantie", "warranty"],
    الحالة: ["الحالة", "حالة", "جديد", "مستعمل", "condition"],
    الرام: ["الرام", "رام", "ram"],
    التخزين: ["التخزين", "ذاكرة", "مساحة", "ستوكاج", "stockage", "storage"],
  };

  return aliases[attributeName] || [attributeName];
}

function findAttributeFacts(
  requestedAttribute: string | undefined,
  productContext: ProductContext,
): string[] {
  if (!requestedAttribute) {
    return [];
  }

  const aliases = getAttributeAliases(requestedAttribute).map((alias) =>
    alias.toLowerCase(),
  );
  const facts: string[] = [];

  for (const [key, value] of Object.entries(productContext.attributes || {})) {
    const normalizedKey = key.toLowerCase();
    if (aliases.some((alias) => normalizedKey.includes(alias) || alias.includes(normalizedKey))) {
      facts.push(`${key}: ${value}`);
    }
  }

  for (const faq of productContext.faqs || []) {
    const question = faq.question.toLowerCase();
    if (aliases.some((alias) => question.includes(alias))) {
      facts.push(`${faq.question}: ${faq.answer}`);
    }
  }

  for (const feature of productContext.features || []) {
    const normalizedFeature = feature.toLowerCase();
    if (aliases.some((alias) => normalizedFeature.includes(alias))) {
      facts.push(feature);
    }
  }

  for (const note of productContext.extraNotes || []) {
    const normalizedNote = note.toLowerCase();
    if (aliases.some((alias) => normalizedNote.includes(alias))) {
      facts.push(note);
    }
  }

  if (requestedAttribute === "الضمان" && productContext.warrantyInfo) {
    facts.push(`الضمان: ${productContext.warrantyInfo}`);
  }

  if (requestedAttribute === "الحالة" && productContext.condition) {
    facts.push(`الحالة: ${productContext.condition}`);
  }

  return facts;
}

function buildProductFactGuidance(
  userMessage: string,
  productContext: ProductContext,
  intent: AgentIntent,
): string {
  const price = formatPrice(productContext);
  const requestedAttribute = inferRequestedAttribute(userMessage);
  const attributeFacts = findAttributeFacts(requestedAttribute, productContext);

  switch (intent) {
    case "delivery_payment_question": {
      const facts = [
        productContext.deliveryInfo,
        compactList(productContext.deliveryAreas),
        productContext.deliveryTime,
        compactList(productContext.paymentMethods),
      ].filter(Boolean);

      return facts.length
        ? `الزبون سول على التوصيل/الدفع. استعمل غير هاد المعطيات: ${facts.join("، ")}. ما تطلبش معلومات الطلب ولا اللون ولا المقاس.`
        : 'معلومات التوصيل/الدفع ما متوفراش. جاوب: "معلومات التوصيل والدفع ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر."';
    }

    case "price_question":
      return price
        ? `الزبون سول على الثمن. الثمن المؤكد هو: ${price}. ممكن تذكر الدفع أو التوصيل فقط إلا كانو متوفرين.`
        : 'الثمن ما متوفرش. جاوب: "الثمن ما متوفرش عندي دابا، نقدر نأكدو لك من عند صاحب المتجر."';

    case "image_request":
      return productContext.images?.length
        ? 'الزبون طلب الصور. جاوب: "أكيد، نقدر نرسل لك صور المنتج." ما تقولش أنك صيفطتي الصور، وما تذكرش لون محدد إلا كان الزبون طلبو.'
        : 'الزبون طلب الصور ولكن الصور ما كايناش فالسياق. جاوب: "الصور ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر."';

    case "product_attribute_question":
      return attributeFacts.length
        ? `الزبون سول على خاصية "${requestedAttribute}". استعمل غير هاد المعلومة: ${attributeFacts.join("، ")}.`
        : `الزبون سول على خاصية "${requestedAttribute || "غير محددة"}" ولكنها ما كايناش ف Product context. جاوب بصيغة طبيعية: "معلومة ${requestedAttribute || "هاد الخاصية"} ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر."`;

    case "color_question":
      return productContext.availableColors?.length
        ? `الألوان المؤكدة: ${compactList(productContext.availableColors)}. إلا سول على لون غير موجود، قول ما متوفرش وذكر المتوفر.`
        : 'الألوان ما متوفراش فالسياق. قول أنك تقدر تأكدها من عند صاحب المتجر.';

    case "size_question":
      return productContext.availableSizes?.length
        ? `المقاسات المؤكدة: ${compactList(productContext.availableSizes)}. جاوب فقط حسب هاد القائمة.`
        : 'المقاسات ما متوفراش فالسياق. قول أنك تقدر تأكدها من عند صاحب المتجر.';

    case "order_intent":
      return `الزبون باغي يشري. طلب غير هاد المعلومات: ${buildOrderFields(productContext)}.`;

    case "unavailable_product_question":
      return `إلا كان المنتوج المطلوب غير "${productContext.productName}"، قول بلطف أنه ما متوفرش واقترح "${productContext.productName}".`;

    case "price_objection":
      return `الزبون كيشوف الثمن غالي. جاوب بتفهم، وذكر غير الحقائق المتوفرة: ${[price, compactList(productContext.paymentMethods), productContext.offer].filter(Boolean).join("، ") || "لا توجد حقائق كافية"}. ما تخترعش الجودة.`;

    case "off_topic":
      return `السؤال خارج الموضوع. جاوب بخفة ورجع للمنتوج "${productContext.productName}" أو التوصيل.`;

    case "general_product_question":
      return `جاوب على "${productContext.productName}" حسب Product context فقط. إلا التفاصيل المطلوبة ناقصة، قول غادي تأكدها من عند صاحب المتجر.`;

    case "unknown":
      return `إذا ما بانش قصد الزبون، طلب توضيح بسيط مرتبط ب "${productContext.productName}" أو التوصيل.`;
  }
}

export function detectBasicIntent(
  userMessage: string,
  productContext?: ProductContext,
): AgentIntent {
  const message = userMessage.trim().toLowerCase();

  if (
    includesAny(message, [
      "صورة",
      "صور",
      "تصاور",
      "photo",
      "photos",
      "pic",
      "pics",
      "وريني",
      "بين ليا",
      "بيّن ليا",
    ])
  ) {
    return "image_request";
  }

  if (
    includesAny(message, [
      "غالي",
      "غالية",
      "بزاف",
      "نقص",
      "نقصو",
      "تخفيض",
      "رخيص",
      "ديسكونت",
      "discount",
    ])
  ) {
    return "price_objection";
  }

  if (
    includesAny(message, [
      "نكوموندي",
      "كوموندي",
      "نطلب",
      "طلب",
      "بغيت نشري",
      "باغي نشري",
      "نأكد",
      "اكد",
      "أكد",
    ])
  ) {
    return "order_intent";
  }

  if (
    includesAny(message, [
      "توصيل",
      "توصل",
      "توصلك",
      "وصل",
      "الدفع",
      "دفع",
      "نخلص",
      "خلص",
      "الأداء",
      "اداء",
      "استلام",
    ])
  ) {
    return "delivery_payment_question";
  }

  if (
    includesAny(message, [
      "شحال",
      "الثمن",
      "تمن",
      "السعر",
      "بشحال",
      "بكم",
    ])
  ) {
    return "price_question";
  }

  if (
    includesAny(message, [
      "لون",
      "الألوان",
      "الالوان",
      "ألوان",
      "الوان",
      "أبيض",
      "ابيض",
      "بيضاء",
      "كحل",
      "اسود",
      "أسود",
      "وردي",
      "روز",
      "حمرة",
      "حمر",
      "أزرق",
      "ازرق",
    ])
  ) {
    return "color_question";
  }

  if (
    includesAny(message, [
      "مقاس",
      "قياس",
      "المقاسات",
      "النمرة",
      "نمرة",
      "taille",
      "size",
      "xs",
      "s",
      "m",
      "l",
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
    ])
  ) {
    return "size_question";
  }

  if (inferRequestedAttribute(message)) {
    return "product_attribute_question";
  }

  const productQuestionKeywords = [
    "عندكم",
    "كاين",
    "واش كاين",
    "متوفر",
    "باغي",
  ];
  const productTypeKeywords = [
    "صباط",
    "سباط",
    "حذاء",
    "كوتشي",
    "بوط",
    "سنيكرز",
    "صندالة",
    "صندل",
    "عطر",
    "برفان",
    "قميجة",
    "تريكو",
    "سروال",
    "تيليفون",
    "تلفون",
    "iphone",
    "ايفون",
    "سامسونغ",
    "ساعة",
    "شنطة",
    "ماكياج",
    ...(productContext?.unavailableProducts || []),
  ];

  if (
    includesAny(message, productQuestionKeywords) &&
    includesAny(message, productTypeKeywords) &&
    !mentionsCurrentProduct(message, productContext)
  ) {
    return "unavailable_product_question";
  }

  if (
    includesAny(message, [
      "ماتش",
      "مباراة",
      "الكورة",
      "كرة",
      "فوت",
      "نكتة",
      "ضحك",
      "رأيك",
      "رايك",
      "طقس",
      "سياسة",
      "أخبار",
      "اخبار",
    ])
  ) {
    return "off_topic";
  }

  if (
    includesAny(message, [
      "منتوج",
      "سلعة",
      "تفاصيل",
      "معلومات",
      "شنو كاين",
      "شنو فيه",
      "كيفاش",
    ]) ||
    mentionsCurrentProduct(message, productContext)
  ) {
    return "general_product_question";
  }

  return "unknown";
}

export function buildMoroccanSalesPrompt(
  userMessage: string,
  productContext: ProductContext,
): string {
  const intent = detectBasicIntent(userMessage, productContext);
  const replyFocus = intentReplyFocus[intent];
  const factGuidance = buildProductFactGuidance(
    userMessage,
    productContext,
    intent,
  );
  const hasImages = Boolean(productContext.images?.length);

  return `
الدور ديالك: مساعد مبيعات مغربي فواتساب لمتجر "${productContext.businessName}".

جاوب غير بالدارجة المغربية وبالحروف العربية. ممنوع الفرنسية، الإنجليزية، الصينية، أو شي لهجة بحال الليبية، المصرية، ولا التونسية.
الجواب خاصو يكون طبيعي، قصير، ودود، وما يفوتش جوج جمل. خرج غير جواب الواتساب النهائي بلا شرح وبلا JSON.

Detected customer intent: ${intent}
Reply focus: ${replyFocus}
Product fact guidance: ${factGuidance}

Product context - استعمل غير هاد المعلومات:
${buildProductKnowledge(productContext)}

حقول الطلب اللي يمكن تطلبها فقط إلا كان الزبون باغي يشري:
${buildOrderFields(productContext)}

قواعد مهمة:
- جاوب حسب Product context و Product fact guidance فقط. ما تخترع حتى معلومة على الثمن، الألوان، المقاسات، التوصيل، الدفع، التخفيضات، الضمان، الحالة، الصور، المميزات، البطارية، الثبات، الأصالة، المادة، أو أي خاصية.
- إلا سولوك على معلومة ناقصة، جاوب بصيغة طبيعية بحال: "هاد المعلومة ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر."
- إلا كانت معلومة محددة ناقصة، سميها: "معلومة البطارية..."، "معلومة الثبات..."، "معلومة الضمان..." حسب السؤال.
- ما تستعملش "شنو بغيتي تعرف أكثر؟" إلا كانت مفيدة وطبيعية. ما تزيدهاش من بعد كل جواب.
- إلا سولو على منتوج مختلف، قول بلطف ما متوفرش واقترح المنتوج الحالي: "${productContext.productName}".
- إلا سولو على الصور: ${
    hasImages
      ? 'قول أن الصور ممكن يتصيفطو، وما تقولش "صيفطتهم" أو تتخيل روابط أو تذكر لون محدد إلا طلبو الزبون.'
      : 'قول: "الصور ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر."'
  }
- إلا سولو على التوصيل أو الدفع، جاوب غير على التوصيل أو الدفع وما تطلبش معلومات الطلب ولا اللون ولا المقاس.
- طلب معلومات الطلب غير إلا قال الزبون بوضوح أنه باغي يكوموندي.
- إلا كان السؤال خارج الموضوع، جاوب بخفة ورجع للمنتوج الحالي أو التوصيل بلا ذكر شي كلمات غريبة.
- ممنوع نهائياً تستعمل هاد العبارات السيئة: إذا شفتلك، شفتلك، مشغولة بالمتاعب، المتاعب، دفع الأموال، الأوردي، تتخليص، نتدارس، لمتاعبنا، شكو، فيوادك، متوفرا، ماهو المنتوج، دارجة ليبية، ليبية، ليبيا، الصينية، Chinese، French، English.
- عوض "إذا شفتلك" استعمل "إذا بغيتي". عوض "دفع الأموال" استعمل "تخلص". عوض "الأوردي" استعمل "الوردي".
- استعمل عبارات مغربية طبيعية بحال: "حالياً ما متوفرش"، "المتوفر دابا"، "نعم متوفر"، "نقدر نعاونك فمعلومات ${productContext.productName} أو التوصيل"، "ماشي مشكل"، "إذا بغيتي".

أمثلة عامة على الأسلوب، ما تستعملش معلومات الأمثلة إلا كانت موجودة ف Product context:
مثال عطر:
المنتوج: عطر رجالي
الزبون: "واش كيبقى مدة طويلة؟"
الجواب الجيد إلا الثبات ما مذكورش: "معلومة الثبات ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر."

مثال هاتف:
المنتوج: iPhone 11
الزبون: "واش البطارية مزيانة؟"
الجواب الجيد إلا البطارية ما مذكوراش: "معلومة البطارية ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر."

مثال ملابس:
المنتوج: قميجة رجالية
الزبون: "كاين XL؟"
الجواب الجيد إلا XL موجود فالمقاسات: "نعم XL متوفر. شنو اللون اللي بغيتي؟"

مثال صور:
الزبون: "صيفط ليا الصور"
الجواب الجيد إلا الصور متوفرة: "أكيد، نقدر نرسل لك صور المنتج."
الجواب الجيد إلا الصور ما متوفراش فالسياق: "الصور ما متوفراش عندي دابا، نقدر نأكدها لك من عند صاحب المتجر."

رسالة الزبون الحالية:
"${userMessage.trim()}"

الجواب النهائي:
`.trim();
}
