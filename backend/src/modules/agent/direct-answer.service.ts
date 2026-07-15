import type { ProductContext } from "./product-context.types";
import { getAttributeReplyResult } from "./direct-answer/attribute-matcher";
import type { DirectAgentResult } from "./direct-answer/direct-answer.types";
import {
  isColorQuestion,
  isDeliveryPaymentQuestion,
  isGreeting,
  isImageRequest,
  isOrderIntent,
  isPriceQuestion,
  isProductIdentityQuestion,
  isRecommendationQuestion,
  isSizeQuestion,
} from "./direct-answer/intent-detectors";
import {
  buildGreetingReply,
  buildProductIdentityReply,
  buildRecommendationReply,
  getColorReply,
  getDeliveryPaymentReply,
  getImageReply,
  getOrderReply,
  getPriceReply,
  getSizeReply,
} from "./direct-answer/reply-builders";

export function getDirectAgentReply(
  message: string,
  productContext: ProductContext,
): DirectAgentResult | null {
  const userMessage = message.trim();

  if (!userMessage) {
    return null;
  }

  if (isGreeting(userMessage)) {
    return {
      reply: buildGreetingReply(productContext),
      actions: [],
    };
  }

  if (isProductIdentityQuestion(userMessage)) {
    return {
      reply: buildProductIdentityReply(productContext),
      actions: [],
    };
  }

  if (isOrderIntent(userMessage)) {
    return {
      reply: getOrderReply(productContext),
      actions: [],
    };
  }

  if (isImageRequest(userMessage)) {
    return getImageReply(productContext);
  }

  if (isRecommendationQuestion(userMessage)) {
    return {
      reply: buildRecommendationReply(productContext),
      actions: [],
    };
  }

  if (isDeliveryPaymentQuestion(userMessage)) {
    const reply = getDeliveryPaymentReply(productContext);

    return reply ? { reply, actions: [] } : null;
  }

  if (isPriceQuestion(userMessage)) {
    const reply = getPriceReply(productContext);

    return reply ? { reply, actions: [] } : null;
  }

  if (isSizeQuestion(userMessage)) {
    return {
      reply: getSizeReply(userMessage, productContext),
      actions: [],
    };
  }

  if (isColorQuestion(userMessage)) {
    return {
      reply: getColorReply(userMessage, productContext),
      actions: [],
    };
  }

  const attributeReply = getAttributeReplyResult(userMessage, productContext);

  return attributeReply
    ? {
        reply: attributeReply.reply,
        actions: [],
        grounded: attributeReply.grounded,
      }
    : null;
}
