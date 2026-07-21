import type {
  AgentReplyUiHint,
  OrderConfirmationPresentation,
} from "../../reply/reply-renderer.types";
import type { CartPlanningPreviewResult } from "../planning/preview/cart-planning-preview.types";
import type { ItemCollectionPreviewResult } from "../item-collection/preview/item-collection-preview.types";
import type { CartReviewPreviewResult } from "../cart-review/cart-review.types";
import type { DeliveryConfirmationPreviewResult } from "../delivery-confirmation/delivery-confirmation.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import {
  buildCartReviewIntroduction,
  buildCartReviewCompletionCopy,
  buildDifferentChoicesCopy,
  buildInitialPlannedPieceCopy,
  buildSameAsPreviousCopy,
  buildSameOrDifferentCopy,
  type PlannedItemOptionDisplay,
} from "./order-runtime-presentation-copy.service";

export type RuntimeReply = {
  text: string;
  replyUi?: AgentReplyUiHint;
  orderConfirmationPresentation?: OrderConfirmationPresentation;
};

const retryText = "وقع مشكل فاختيارك. عاود اختار من الخيارات اللي باينين ليك.";

function reply(text: string | undefined, replyUi?: AgentReplyUiHint): RuntimeReply {
  return { text: text?.trim() || retryText, ...(replyUi ? { replyUi } : {}) };
}

function replyWithVisibleInteractiveBody(
  text: string | undefined,
  replyUi?: AgentReplyUiHint,
): RuntimeReply {
  const visibleText = text?.trim() || retryText;
  if (!replyUi) return { text: visibleText };
  return {
    text: visibleText,
    replyUi: {
      ...replyUi,
      body: visibleText,
      options: replyUi.options?.map((option) => ({ ...option })),
    },
  };
}

function plannedPieceCount(result: ItemCollectionPreviewResult): number {
  return result.cartAfter.targetItemCount || result.progression?.progress.targetUnits || 1;
}

function completedPieceCount(result: ItemCollectionPreviewResult): number {
  return result.progression?.progress.completedPieceCount
    ?? result.progression?.progress.completedUnits
    ?? 0;
}

function currentSlotNumber(result: ItemCollectionPreviewResult): number {
  return result.progression?.progress.currentSlotIndex
    ?? result.presentation?.itemNumber
    ?? completedPieceCount(result) + 1;
}

function currentOptionPrompt(result: ItemCollectionPreviewResult): string {
  const label = result.presentation?.field?.label?.trim();
  if (!label) return result.presentation?.text || retryText;
  const verb = result.presentation?.kind === "OPTION_TEXT_INPUT" ? "دخل" : "اختار";
  return `${verb} ${label} ديالها.`;
}

function completedOptionDisplays(
  result: ItemCollectionPreviewResult,
  fields: readonly RequiredOrderField[],
): PlannedItemOptionDisplay[] {
  const item = [...result.cartAfter.items]
    .reverse()
    .find((candidate) => candidate.status === "COMPLETE");
  if (!item) return [];
  return fields
    .filter((field) => field.source === "productOption")
    .flatMap((field) => {
      const value = item.selectedOptions[field.key];
      return value === undefined || value === null
        ? []
        : [{ label: field.label || field.key, value: String(value) }];
    });
}

export function replyFromPlanning(result: CartPlanningPreviewResult): RuntimeReply {
  if (result.prompt?.key === "REQUEST_CUSTOM_QUANTITY") {
    return reply("شحال من قطعة بغيتي؟");
  }
  return replyWithVisibleInteractiveBody(result.selector?.text, result.selector?.uiHints);
}

export function replyFromItemCollection(
  result: ItemCollectionPreviewResult,
  fields: readonly RequiredOrderField[] = [],
  actionId?: string,
): RuntimeReply {
  const presentation = result.presentation;
  if (result.nextStep === "CART_REVIEW_READY") {
    return reply(buildCartReviewIntroduction(plannedPieceCount(result)));
  }
  const interactiveUi = result.shortcutPresentation?.uiHints || presentation?.uiHints;
  const total = plannedPieceCount(result);
  const completed = completedPieceCount(result);

  if (result.nextStep === "SAME_OR_DIFFERENT_ITEM_OPTIONS") {
    if (actionId === "cart_item_previous:same") {
      return replyWithVisibleInteractiveBody(
        buildSameAsPreviousCopy({ plannedPieceCount: total, completedPieceCount: completed }),
        interactiveUi,
      );
    }
    return replyWithVisibleInteractiveBody(
      buildSameOrDifferentCopy({
        plannedPieceCount: total,
        completedPieceCount: completed,
        selectedOptions: completedOptionDisplays(result, fields),
      }),
      interactiveUi,
    );
  }

  if (actionId === "cart_item_previous:different") {
    return replyWithVisibleInteractiveBody(
      buildDifferentChoicesCopy({
        currentSlotNumber: currentSlotNumber(result),
        optionPrompt: currentOptionPrompt(result),
      }),
      interactiveUi,
    );
  }

  return replyWithVisibleInteractiveBody(
    presentation?.text || (result.shortcutPresentation ? "بغيتي نفس اختيارات القطعة اللي قبل ولا اختيارات مختلفة؟" : undefined),
    interactiveUi,
  );
}

/** First-entry planning asks for a total piece count, then begins slot one in one reply. */
export function replyFromInitialPlannedItemCollection(
  result: ItemCollectionPreviewResult,
  fields: readonly RequiredOrderField[] = [],
): RuntimeReply {
  if (result.nextStep === "SAME_OR_DIFFERENT_ITEM_OPTIONS") {
    return replyFromItemCollection(result, fields);
  }
  const itemReply = replyFromItemCollection(result, fields);
  const text = buildInitialPlannedPieceCopy({
    plannedPieceCount: plannedPieceCount(result),
    optionPrompt: currentOptionPrompt(result),
  });
  return replyWithVisibleInteractiveBody(text, itemReply.replyUi);
}

export function replyFromCartReview(
  result: CartReviewPreviewResult,
  introduction?: string,
): RuntimeReply {
  const text = [introduction, result.presentation?.text]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n");
  return replyWithVisibleInteractiveBody(text, result.presentation?.uiHints);
}

export function replyFromCompletedPlannedItemCartReview(input: {
  item: ItemCollectionPreviewResult;
  review: CartReviewPreviewResult;
  actionId?: string;
}): RuntimeReply {
  const total = plannedPieceCount(input.item);
  const completed = completedPieceCount(input.item);
  const sameAcknowledgement = input.actionId === "cart_item_previous:same"
    ? buildSameAsPreviousCopy({ plannedPieceCount: total, completedPieceCount: completed })
    : undefined;
  const introduction = [sameAcknowledgement, buildCartReviewCompletionCopy(total)]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n\n");
  return replyFromCartReview(input.review, introduction);
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
