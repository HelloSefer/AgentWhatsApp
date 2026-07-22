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
import { informationMessage } from "../../conversation-engine/adapters/information-conversation.adapter";
import { salesMessage } from "../../conversation-engine/adapters/sales-conversation.adapter";

export function getPriceReply(productContext: ProductContext): string | null {
  if (!productContext.price) {
    return salesMessage("sales.price_unknown");
  }

  const price = formatPriceText(productContext);
  return productContext.offer
    ? salesMessage("sales.price_with_offer", { price, offer: productContext.offer })
    : salesMessage("sales.price", { price });
}

export function buildGreetingReply(productContext: ProductContext): string {
  const productName = productContext.productName?.trim();

  if (!productName) {
    return salesMessage("sales.greeting_unknown_product");
  }

  const price = formatPriceText(productContext);

  if (price) {
    return salesMessage("sales.greeting_with_price", { productName, price });
  }

  return salesMessage("sales.greeting_product_only", { productName });
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
      ? salesMessage("sales.recommendation_two_hints", { firstHint, secondHint })
      : salesMessage("sales.recommendation_one_hint", { firstHint });
  }

  if (colors.length) {
    const firstColor = formatColorName(colors[0]);
    const secondColor = colors[1] ? formatColorName(colors[1]) : "";

    if (secondColor) {
      return salesMessage("sales.recommendation_two_colors", { firstColor, secondColor });
    }

    return salesMessage("sales.recommendation_one_color", { firstColor });
  }

  const productName = productContext.productName?.trim();

  if (!productName) {
    return salesMessage("sales.recommendation_generic");
  }

  const features = productContext.features?.filter(Boolean).slice(0, 2) || [];
  const price = formatPriceText(productContext);
  const details = features.length
    ? salesMessage("sales.recommendation_feature_details", {
        features: formatNaturalList(features),
      })
    : "";
  const secondSentence = productContext.offer
    ? salesMessage("sales.recommendation_offer", { offer: productContext.offer })
    : price
      ? salesMessage("sales.recommendation_price", { price })
      : salesMessage("sales.recommendation_more");

  return salesMessage("sales.recommendation_product", {
    productName,
    details,
    secondSentence,
  });
}

export function buildProductIdentityReply(
  productContext: ProductContext,
): string {
  const productName = productContext.productName?.trim();

  if (!productName) {
    return salesMessage("sales.identity_unknown");
  }

  const price = formatPriceText(productContext);
  const colors = productContext.availableColors?.filter(Boolean) || [];
  const sizes = productContext.availableSizes?.filter(Boolean) || [];
  const variants = productContext.variants?.filter(Boolean) || [];
  const features = productContext.features?.filter(Boolean) || [];

  const details: string[] = [];

  if (price) {
    details.push(salesMessage("sales.detail_price", { price }));
  }

  if (colors.length) {
    details.push(salesMessage("sales.detail_colors", { colors: formatColorList(colors) }));
  }

  if (sizes.length) {
    details.push(salesMessage("sales.detail_sizes", { sizes: formatSizesSummary(sizes) }));
  }

  if (variants.length) {
    details.push(salesMessage("sales.detail_variants", {
      variants: formatNaturalList(variants),
    }));
  }

  if (features.length) {
    details.push(salesMessage("sales.detail_features", {
      features: formatNaturalList(features.slice(0, 2)),
    }));
  }

  if (productContext.offer) {
    details.push(salesMessage("sales.detail_offer", { offer: productContext.offer }));
  }

  if (details.length) {
    return salesMessage("sales.identity_with_details", {
      productName,
      details: details.join("، "),
    });
  }

  if (productContext.category) {
    return salesMessage("sales.identity_category", {
      productName,
      category: productContext.category,
    });
  }

  if (productContext.description) {
    return salesMessage("sales.identity_description", {
      productName,
      description: productContext.description,
    });
  }

  return salesMessage("sales.identity_basic", { productName });
}

export function getDeliveryPaymentReply(
  productContext: ProductContext,
): string | null {
  const deliveryText = getDeliveryText(productContext);
  const paymentText = getPaymentText(productContext);

  if (deliveryText && paymentText) {
    return salesMessage("sales.delivery_payment_both", { deliveryText, paymentText });
  }

  if (deliveryText) {
    return salesMessage("sales.delivery_only", { deliveryText });
  }

  if (paymentText) {
    return salesMessage("sales.payment_only", { paymentText });
  }

  return salesMessage("sales.delivery_payment_unknown");
}

export function getImageReply(productContext: ProductContext): DirectAgentResult {
  if (!productContext.images?.length) {
    return {
      reply: salesMessage("sales.images_unknown"),
      actions: [],
    };
  }

  return {
    reply: salesMessage("sales.images_available"),
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
    return informationMessage("information.size_owner_fallback");
  }

  if (requestedSize) {
    return isAvailableSize(requestedSize, productContext)
      ? informationMessage("information.size_available", { selectedSize: requestedSize })
      : informationMessage("information.size_unavailable", {
          selectedSize: requestedSize,
          availableSizes: formatNaturalList(availableSizes),
        });
  }

  return informationMessage("information.sizes_available", {
    availableSizes: formatNaturalList(availableSizes),
  });
}

export function getColorReply(
  message: string,
  productContext: ProductContext,
): string {
  const availableColors = productContext.availableColors?.filter(Boolean) || [];
  const requestedColor = getColorFromMessage(message);

  if (!availableColors.length) {
    return informationMessage("information.color_owner_fallback");
  }

  if (requestedColor) {
    return isAvailableColor(requestedColor, productContext)
      ? informationMessage("information.color_available", {
          selectedColor: requestedColor.replyName.replace(/^ال/, ""),
        })
      : informationMessage("information.color_unavailable", {
          selectedColor: requestedColor.replyName,
          availableColors: formatColorList(availableColors),
        });
  }

  return informationMessage("information.colors_available", {
    availableColors: formatColorList(availableColors),
  });
}

export function getOrderReply(productContext: ProductContext): string {
  const orderFields = productContext.requiredOrderFields?.filter(Boolean);

  if (!orderFields?.length) {
    return salesMessage("sales.order_default");
  }

  return salesMessage("sales.order_fields", {
    orderFields: formatNaturalList(orderFields),
  });
}
