import type { ProductContext } from "../product-context.types";
import type { RequiredOrderField } from "../config/required-fields.types";
import type { DisplayMode } from "../config/seller-config.types";
import type { RenderedAgentReply } from "../reply/reply-renderer.types";
import {
  getColorReply,
  getSizeReply,
} from "../direct-answer/reply-builders";
import type { ProductInfoRequest } from "./product-info.service";
import {
  matchAvailableInfoColor,
  matchAvailableInfoSize,
} from "./product-info.service";

type ProductInfoReplyInput = {
  message: string;
  request: ProductInfoRequest;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
  infoMenuDisplayMode?: DisplayMode;
};

const infoMenuOptions = [
  { id: "info:price", label: "الثمن", fact: "price" },
  { id: "info:sizes", label: "المقاسات", fact: "sizes" },
  { id: "info:colors", label: "الألوان", fact: "colors" },
  {
    id: "info:delivery_payment",
    label: "التوصيل والدفع",
    fact: "delivery_payment",
  },
  { id: "info:how_to_order", label: "طريقة الطلب", fact: "always" },
  { id: "info:order_now", label: "أطلب الآن", fact: "always" },
] as const;

const followupOptions = [
  { id: "info:order_now", label: "نبدأ الطلب", value: "نبدأ الطلب" },
  { id: "info:menu", label: "معلومات أخرى", value: "معلومات أخرى" },
];
const selectionFollowupOptions = [
  { id: "info:continue_order", label: "نكمل الطلب", value: "نكمل الطلب" },
  { id: "info:menu", label: "معلومات أخرى", value: "معلومات أخرى" },
];

function formatCurrency(productContext: ProductContext): string {
  return productContext.currency === "MAD"
    ? "درهم"
    : productContext.currency || "";
}

function formatConfiguredList(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join("، ");
}

function ensureSentence(value: string): string {
  const cleanValue = value.trim().replace(/[.!؟]+$/, "");

  return cleanValue ? `${cleanValue}.` : "";
}

function getDeliveryLine(productContext: ProductContext): string | undefined {
  const delivery = productContext.deliveryInfo?.trim();

  if (!delivery) {
    return undefined;
  }

  if (/متوفر/.test(delivery)) {
    return ensureSentence(delivery);
  }

  if (/^التوصيل\s+/.test(delivery)) {
    return ensureSentence(delivery.replace(/^التوصيل\s+/, "التوصيل متوفر "));
  }

  return ensureSentence(`التوصيل متوفر: ${delivery}`);
}

function getPaymentLine(productContext: ProductContext): string | undefined {
  const payment = productContext.paymentMethods?.find(Boolean)?.trim();

  if (!payment) {
    return undefined;
  }

  return ensureSentence(/متوفر/.test(payment) ? payment : `${payment} متوفر`);
}

function getDeliveryCostAnswer(message: string, productContext: ProductContext): string | undefined {
  const asksCostOrFree = /(?:مجاني|فابور|gratuite|gratuit|free|شحال|بكم|combien|cost|prix)/i.test(message);

  if (!asksCostOrFree) {
    return undefined;
  }

  if (productContext.deliveryIsFree === true || productContext.deliveryPricing?.mode === "ALL_FREE") {
    return "التوصيل مجاني.";
  }

  if (typeof productContext.deliveryPrice === "number") {
    return `ثمن التوصيل هو ${productContext.deliveryPrice} ${productContext.currency === "MAD" ? "درهم" : productContext.currency || ""}.`.replace(/\s+\./, ".");
  }

  if (productContext.deliveryIsFree === false || productContext.deliveryPricing?.enabled) {
    return "التوصيل ماشي مجاني فكل المدن، والثمن كيتحدد حسب المدينة.";
  }

  return undefined;
}

function hasMenuFact(
  fact: (typeof infoMenuOptions)[number]["fact"],
  productContext: ProductContext,
): boolean {
  if (fact === "always") {
    return true;
  }

  if (fact === "price") {
    return Boolean(productContext.price);
  }

  if (fact === "sizes") {
    return Boolean(productContext.availableSizes?.length);
  }

  if (fact === "colors") {
    return Boolean(productContext.availableColors?.length);
  }

  return Boolean(
    productContext.deliveryInfo || productContext.paymentMethods?.length,
  );
}

function getMenuOptions(productContext: ProductContext) {
  return infoMenuOptions
    .filter((option) => hasMenuFact(option.fact, productContext))
    .map(({ id, label }) => ({ id, label, value: label }));
}

function getTextFallback(options: Array<{ label: string }>): string {
  return options.map((option) => `- ${option.label}`).join("\n");
}

function getConversationalProductName(productContext: ProductContext): string {
  return (
    productContext.conversationalProductName?.trim() ||
    productContext.productName.trim() ||
    "المنتج"
  );
}

function buildMenuReply(input: ProductInfoReplyInput): RenderedAgentReply {
  const options = getMenuOptions(input.productContext);
  const heading =
    ["info:menu", "info:more_info"].includes(input.message.trim()) || input.message.includes("معلومات")
      ? "اختار المعلومة اللي بغيتي 👇"
      : `أكيد 👌 شنو بغيتي تعرف على ${getConversationalProductName(input.productContext)}؟`;
  const textMode = input.infoMenuDisplayMode === "text";

  return {
    text: textMode ? `${heading}\n\n${getTextFallback(options)}` : heading,
    ui: textMode
      ? { kind: "none", purpose: "info_menu" }
      : {
          kind: "list",
          purpose: "info_menu",
          title: "معلومات المنتج",
          body: heading,
          options,
        },
  };
}

function withColorArticle(color: string): string {
  return color.startsWith("ال") ? color : `ال${color}`;
}

function buildSoftSelectionReply(input: {
  field: "size" | "color";
  value: string;
  textMode: boolean;
}): RenderedAgentReply {
  const selectionText =
    input.field === "size"
      ? `المقاس ${input.value} متوفر ✅`
      : `اللون ${withColorArticle(input.value)} متوفر ✅`;
  const body =
    input.field === "size"
      ? `${selectionText}\n\nنكملو الطلب بهاد المقاس ولا بغيتي تعرف معلومات أخرى؟`
      : `${selectionText}\n\nبغيتي نكمل لك الطلب بهذا اللون، ولا تشوف معلومات أخرى؟`;
  const fallback =
    `${body}\n\nكتب "نكمل الطلب" باش نكملو الطلب، أو "معلومات أخرى" باش تشوف معلومات أخرى.`;

  return {
    text: input.textMode ? fallback : body,
    ui: input.textMode
      ? { kind: "none", purpose: "info_menu" }
      : {
          kind: "buttons",
          purpose: "info_menu",
          body,
          options: selectionFollowupOptions,
        },
  };
}

function buildHowToOrderReply(input: ProductInfoReplyInput): string {
  const requiredFields = input.requiredFields || [];
  const productFields = requiredFields
    .filter(
      (field) => field.source === "productOption" || field.key === "quantity",
    )
    .map((field) => field.label);
  const hasDeliveryFields = requiredFields.some(
    (field) =>
      field.source === "customerField" && field.key !== "quantity",
  );
  const requestedParts = [
    ...productFields,
    ...(hasDeliveryFields ? ["معلومات التوصيل"] : []),
  ];
  const fieldsText = requestedParts.length
    ? requestedParts.join("، ")
    : "معلومات الطلب والتوصيل";

  return `باش تطلب، غادي نطلب منك ${fieldsText}. من بعد نعرض عليك ملخص الطلب باش تراجعو.`;
}

function buildAvailabilityReply(productContext: ProductContext): string {
  if (productContext.stockInfo) {
    return ensureSentence(productContext.stockInfo);
  }

  if (productContext.offer) {
    return `المنتج متوفر حالياً. ${ensureSentence(productContext.offer)}`;
  }

  return "معلومة التوفر ما محدداش دابا. نقدر نعاونك فالثمن، المقاسات أو الألوان.";
}

function buildTopicText(input: ProductInfoReplyInput): string {
  if (input.request.topic === "price") {
    if (!input.productContext.price) {
      return "الثمن ما محددش دابا.";
    }

    return `الثمن هو ${input.productContext.price} ${formatCurrency(
      input.productContext,
    )}.\n${getPaymentLine(input.productContext) || ""}`.trim();
  }

  if (input.request.topic === "sizes") {
    return input.request.requestedSize
      ? getSizeReply(input.message, input.productContext)
      : input.productContext.availableSizes?.length
        ? "هادو هما المقاسات المتوفرة👇\nاختار المقاس المناسب ليك"
        : "معلومة المقاسات ما محدداش دابا.";
  }

  if (input.request.topic === "colors") {
    return input.request.requestedColor
      ? getColorReply(input.message, input.productContext)
      : input.productContext.availableColors?.length
        ? "الألوان المتوفرة:\nاختار اللون اللي عجبك 👇"
        : "معلومة الألوان ما محدداش دابا.";
  }

  if (input.request.topic === "delivery_payment") {
    const lines = [
      getDeliveryCostAnswer(input.message, input.productContext),
      getDeliveryLine(input.productContext),
      getPaymentLine(input.productContext),
    ].filter((line): line is string => Boolean(line));

    return lines.length
      ? lines.join("\n")
      : "معلومات التوصيل والدفع ما محدداش دابا.";
  }

  if (input.request.topic === "availability") {
    return buildAvailabilityReply(input.productContext);
  }

  return buildHowToOrderReply(input);
}

export function buildProductInfoReply(
  input: ProductInfoReplyInput,
): RenderedAgentReply {
  if (input.request.topic === "menu") {
    return buildMenuReply(input);
  }

  const textMode = input.infoMenuDisplayMode === "text";

  if (input.request.topic === "sizes") {
    const availableSize = matchAvailableInfoSize(
      input.request.requestedSize,
      input.productContext,
    );

    if (availableSize) {
      return buildSoftSelectionReply({
        field: "size",
        value: availableSize,
        textMode,
      });
    }

    const sizes = input.productContext.availableSizes || [];
    const text = buildTopicText(input);

    if (!sizes.length || input.request.requestedSize) {
      return {
        text,
        ui: { kind: "none", purpose: "info_menu" },
      };
    }

    return {
      text: textMode
        ? `${text}\n\n${getTextFallback(sizes.map((size) => ({ label: size })))}`
        : text,
      ui: textMode
        ? { kind: "none", purpose: "info_menu" }
        : {
            kind: "list",
            purpose: "field_options",
            title: "المقاسات",
            body: text,
            options: sizes.map((size) => ({
              id: `size:${size}`,
              label: size,
              value: size,
            })),
          },
    };
  }

  if (input.request.topic === "colors") {
    const availableColor = matchAvailableInfoColor(
      input.request.requestedColor,
      input.productContext,
    );

    if (availableColor) {
      return buildSoftSelectionReply({
        field: "color",
        value: availableColor,
        textMode,
      });
    }

    const colors = input.productContext.availableColors || [];
    const text = buildTopicText(input);

    if (!colors.length || input.request.requestedColor) {
      return {
        text,
        ui: { kind: "none", purpose: "info_menu" },
      };
    }

    return {
      text: textMode
        ? `${text}\n\n${getTextFallback(colors.map((color) => ({ label: color })))}`
        : text,
      ui: textMode
        ? { kind: "none", purpose: "info_menu" }
        : {
            kind: colors.length <= 3 ? "buttons" : "list",
            purpose: "field_options",
            title: "الألوان",
            body: text,
            options: colors.map((color) => ({
              id: `color:${color}`,
              label: color,
              value: color,
            })),
          },
    };
  }

  const text = buildTopicText(input);

  return {
    text: textMode
      ? `${text}\n\nإلا بغيتي تطلب كتب: أطلب الآن\nوإلا بغيتي معلومات أخرى كتب: معلومات أخرى`
      : text,
    ui: textMode
      ? { kind: "none", purpose: "info_menu" }
      : {
          kind: "buttons",
          purpose: "info_menu",
          body: text,
          options: followupOptions,
        },
  };
}
