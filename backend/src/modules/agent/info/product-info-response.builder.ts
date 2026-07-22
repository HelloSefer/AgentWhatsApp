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
import {
  informationLabel,
  informationMessage,
} from "../../conversation-engine/adapters/information-conversation.adapter";
import { resolveProductConversationWording } from "../../conversation-engine/adapters/product-wording.adapter";
import { commonLabel } from "../../conversation-engine/adapters/common-conversation.adapter";

type ProductInfoReplyInput = {
  message: string;
  request: ProductInfoRequest;
  productContext: ProductContext;
  requiredFields?: RequiredOrderField[];
  infoMenuDisplayMode?: DisplayMode;
};

const infoMenuOptions = [
  { id: "info:price", label: informationLabel("information.price"), fact: "price" },
  { id: "info:sizes", label: informationLabel("information.sizes"), fact: "sizes" },
  { id: "info:colors", label: informationLabel("information.colors"), fact: "colors" },
  {
    id: "info:delivery_payment",
    label: informationLabel("information.delivery_payment"),
    fact: "delivery_payment",
  },
  { id: "info:how_to_order", label: informationLabel("information.how_to_order"), fact: "always" },
  { id: "info:order_now", label: informationLabel("information.order_now"), fact: "always" },
] as const;

const followupOptions = [
  { id: "info:order_now", label: informationLabel("information.start_order"), value: informationLabel("information.start_order") },
  { id: "info:menu", label: informationLabel("information.more"), value: informationLabel("information.more") },
];
const selectionFollowupOptions = [
  { id: "info:continue_order", label: informationLabel("information.continue_order"), value: informationLabel("information.continue_order") },
  { id: "info:menu", label: informationLabel("information.more"), value: informationLabel("information.more") },
];

function formatCurrency(productContext: ProductContext): string {
  return productContext.currency === "MAD"
    ? commonLabel("common.currency_mad")
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

  return informationMessage("information.delivery_detail", { deliveryText: delivery });
}

function getPaymentLine(productContext: ProductContext): string | undefined {
  const payment = productContext.paymentMethods?.find(Boolean)?.trim();

  if (!payment) {
    return undefined;
  }

  return /متوفر/.test(payment)
    ? ensureSentence(payment)
    : informationMessage("information.payment_available", { paymentText: payment });
}

function getDeliveryCostAnswer(message: string, productContext: ProductContext): string | undefined {
  const asksCostOrFree = /(?:مجاني|فابور|gratuite|gratuit|free|شحال|بكم|combien|cost|prix)/i.test(message);

  if (!asksCostOrFree) {
    return undefined;
  }

  if (productContext.deliveryIsFree === true || productContext.deliveryPricing?.mode === "ALL_FREE") {
    return informationMessage("information.delivery_free");
  }

  if (typeof productContext.deliveryPrice === "number") {
    return informationMessage("information.delivery_paid", {
      deliveryAmount: productContext.deliveryPrice,
      currency: productContext.currency === "MAD"
        ? commonLabel("common.currency_mad")
        : productContext.currency || "",
    }).replace(/\s+\./, ".");
  }

  if (productContext.deliveryIsFree === false || productContext.deliveryPricing?.enabled) {
    return informationMessage("information.delivery_variable");
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
  return resolveProductConversationWording(productContext).conversationalName;
}

function buildMenuReply(input: ProductInfoReplyInput): RenderedAgentReply {
  const options = getMenuOptions(input.productContext);
  const heading =
    ["info:menu", "info:more_info"].includes(input.message.trim()) || input.message.includes("معلومات")
      ? informationMessage("information.menu_opening")
      : informationMessage("information.opening", {
          productConversationalName: getConversationalProductName(input.productContext),
        });
  const textMode = input.infoMenuDisplayMode === "text";

  return {
    text: textMode ? `${heading}\n\n${getTextFallback(options)}` : heading,
    ui: textMode
      ? { kind: "none", purpose: "info_menu" }
      : {
          kind: "list",
          purpose: "info_menu",
          title: informationLabel("information.product_title"),
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
      ? informationMessage("information.option_available_size", { optionValue: input.value })
      : informationMessage("information.option_available_color", { optionValue: withColorArticle(input.value) });
  const body =
    input.field === "size"
      ? informationMessage("information.size_followup", { selectionText })
      : informationMessage("information.color_followup", { selectionText });
  const fallback = informationMessage("information.text_followup", { body });

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
    ...(hasDeliveryFields ? [informationLabel("information.delivery_fields")] : []),
  ];
  const fieldsText = requestedParts.length
    ? requestedParts.join("، ")
    : informationLabel("information.order_delivery_fields");

  return informationMessage("information.how_to_order", { fieldsText });
}

function buildAvailabilityReply(productContext: ProductContext): string {
  if (productContext.stockInfo) {
    return ensureSentence(productContext.stockInfo);
  }

  if (productContext.offer) {
    return informationMessage("information.availability_with_offer", {
      offerText: ensureSentence(productContext.offer),
    });
  }

  return informationMessage("information.availability_unknown");
}

function buildTopicText(input: ProductInfoReplyInput): string {
  if (input.request.topic === "price") {
    if (!input.productContext.price) {
      return informationMessage("information.price_unknown");
    }

    return `${informationMessage("information.price", {
      price: input.productContext.price,
      currency: formatCurrency(input.productContext),
    })}\n${getPaymentLine(input.productContext) || ""}`.trim();
  }

  if (input.request.topic === "sizes") {
    return input.request.requestedSize
      ? getSizeReply(input.message, input.productContext)
      : input.productContext.availableSizes?.length
        ? informationMessage("information.size_list")
        : informationMessage("information.sizes_unknown");
  }

  if (input.request.topic === "colors") {
    return input.request.requestedColor
      ? getColorReply(input.message, input.productContext)
      : input.productContext.availableColors?.length
        ? informationMessage("information.color_list")
        : informationMessage("information.colors_unknown");
  }

  if (input.request.topic === "delivery_payment") {
    const lines = [
      getDeliveryCostAnswer(input.message, input.productContext),
      getDeliveryLine(input.productContext),
      getPaymentLine(input.productContext),
    ].filter((line): line is string => Boolean(line));

    return lines.length
      ? lines.join("\n")
      : informationMessage("information.delivery_payment_unknown");
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
            title: informationLabel("information.sizes"),
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
            title: informationLabel("information.colors"),
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
      ? informationMessage("information.text_actions_hint", { body: text })
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
