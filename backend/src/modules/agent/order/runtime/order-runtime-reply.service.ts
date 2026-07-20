import type {
  AgentReplyUiHint,
  OrderConfirmationPresentation,
} from "../../reply/reply-renderer.types";
import type { CartPlanningPreviewResult } from "../planning/preview/cart-planning-preview.types";
import type { ItemCollectionPreviewResult } from "../item-collection/preview/item-collection-preview.types";
import type { CartReviewPreviewResult } from "../cart-review/cart-review.types";
import type { DeliveryConfirmationPreviewResult } from "../delivery-confirmation/delivery-confirmation.types";

export type RuntimeReply = {
  text: string;
  replyUi?: AgentReplyUiHint;
  orderConfirmationPresentation?: OrderConfirmationPresentation;
};

const retryText = "وقع مشكل فاختيارك. عاود اختار من الخيارات اللي باينين ليك.";

function reply(text: string | undefined, replyUi?: AgentReplyUiHint): RuntimeReply {
  return { text: text?.trim() || retryText, ...(replyUi ? { replyUi } : {}) };
}

export function replyFromPlanning(result: CartPlanningPreviewResult): RuntimeReply {
  if (result.prompt?.key === "REQUEST_CUSTOM_QUANTITY") {
    return reply("شحال من قطعة بغيتي؟");
  }
  return reply(result.selector?.text, result.selector?.uiHints);
}

export function replyFromItemCollection(result: ItemCollectionPreviewResult): RuntimeReply {
  const presentation = result.presentation;
  if (result.nextStep === "CART_REVIEW_READY") {
    return reply("مزيان، نراجعو السلة ديالك دابا.");
  }
  return reply(
    presentation?.text || (result.shortcutPresentation ? "بغيتي نفس اختيارات القطعة اللي قبل ولا اختيارات مختلفة؟" : undefined),
    result.shortcutPresentation?.uiHints || presentation?.uiHints,
  );
}

export function replyFromCartReview(result: CartReviewPreviewResult): RuntimeReply {
  return reply(result.presentation?.text, result.presentation?.uiHints);
}

export function replyFromDelivery(result: DeliveryConfirmationPreviewResult): RuntimeReply {
  return {
    ...reply(result.presentation?.text, result.presentation?.uiHints),
    ...(result.presentation?.orderConfirmationPresentation
      ? {
          orderConfirmationPresentation: structuredClone(
            result.presentation.orderConfirmationPresentation,
          ),
        }
      : {}),
  };
}

export function staleActionReply(): RuntimeReply {
  return { text: "هاد الاختيار ما بقاش صالح دابا. تبع آخر رسالة وصلاتك باش نكملو." };
}

export function recoveryReply(): RuntimeReply {
  return { text: "وقع مشكل صغير فمعلومات الطلب. عاود من آخر اختيار من فضلك." };
}
