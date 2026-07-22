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
  buildDifferentChoicesCopy,
  buildInitialPlannedPieceCopy,
  buildSameAsPreviousCopy,
  buildSameOrDifferentCopy,
  type PlannedItemOptionDisplay,
} from "./order-runtime-presentation-copy.service";
import { buildOrderEntryOptionPresentation } from "../item-collection/presentation/item-collection-presentation.service";

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

type InitialItemOptionSummary = {
  selectedSize: string;
  productPluralName: string;
};

function replyFromInitialSizeQuantitySelector(
  result: CartPlanningPreviewResult,
  input: InitialItemOptionSummary,
): RuntimeReply | undefined {
  const selector = result.selector;
  if (!selector?.uiHints || selector.promptKey !== "SELECT_QUANTITY") {
    return undefined;
  }

  const text = `باش نكمّلو الطلب، واش بغيتي غير هادي بالمقاس ${input.selectedSize}، ولا تزيد عليها ${input.productPluralName} خرين وتختار ليهم المقاس واللون من بعد؟`;
  const labels: Record<string, string> = {
    "cart_quantity:1": "غير هادي",
    "cart_quantity:2": "نزيد وحدة",
    "cart_quantity:3": "نزيد جوج",
  };

  return replyWithVisibleInteractiveBody(text, {
    ...selector.uiHints,
    options: selector.uiHints.options?.map((option) => ({
      ...option,
      label: labels[option.id] || option.label,
    })),
  });
}

export function replyFromPlanning(
  result: CartPlanningPreviewResult,
  initialItemOptionSummary?: InitialItemOptionSummary,
): RuntimeReply {
  if (initialItemOptionSummary) {
    const continuationReply = replyFromInitialSizeQuantitySelector(
      result,
      initialItemOptionSummary,
    );
    if (continuationReply) return continuationReply;
  }

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
    const differentUi =
      result.presentation?.field?.key === "size" && interactiveUi?.kind === "list"
        ? { ...interactiveUi, buttonText: "اختار المقاس" }
        : interactiveUi;
    return replyWithVisibleInteractiveBody(
      buildDifferentChoicesCopy({
        currentSlotNumber: currentSlotNumber(result),
        optionPrompt: currentOptionPrompt(result),
      }),
      differentUi,
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
  initialItemOptionSummary?: InitialItemOptionSummary,
): RuntimeReply {
  if (result.nextStep === "SAME_OR_DIFFERENT_ITEM_OPTIONS") {
    return replyFromItemCollection(result, fields);
  }
  const itemReply = replyFromItemCollection(result, fields);
  if (
    initialItemOptionSummary &&
    result.presentation?.field?.key === "color"
  ) {
    const text = plannedPieceCount(result) === 1
      ? `مزيان 👌 المقاس ${initialItemOptionSummary.selectedSize} تسجّل.\nدابا اختار اللون ديالها 👇`
      : plannedPieceCount(result) === 2
        ? `مزيان 👌 غادي يكونو جوج ${initialItemOptionSummary.productPluralName}.\n\nالأولى بالمقاس ${initialItemOptionSummary.selectedSize}، دابا اختار اللون ديالها 👇`
        : `مزيان 👌 غادي يكونو ${plannedPieceCount(result)} ${initialItemOptionSummary.productPluralName}.\n\nالأولى بالمقاس ${initialItemOptionSummary.selectedSize}، دابا اختار اللون ديالها 👇`;
    return replyWithVisibleInteractiveBody(
      text,
      itemReply.replyUi,
    );
  }
  const text = buildInitialPlannedPieceCopy({
    plannedPieceCount: plannedPieceCount(result),
    optionPrompt: currentOptionPrompt(result),
  });
  return replyWithVisibleInteractiveBody(text, itemReply.replyUi);
}

export function replyFromOrderEntryOption(field: RequiredOrderField): RuntimeReply {
  const presentation = buildOrderEntryOptionPresentation(field);
  return replyWithVisibleInteractiveBody(presentation.text, presentation.uiHints);
}

export function replyFromCartReview(
  result: CartReviewPreviewResult,
  _introduction?: string,
): RuntimeReply {
  return replyWithVisibleInteractiveBody(
    result.presentation?.text,
    result.presentation?.uiHints,
  );
}

export function replyFromCompletedPlannedItemCartReview(input: {
  item: ItemCollectionPreviewResult;
  review: CartReviewPreviewResult;
  actionId?: string;
}): RuntimeReply {
  return replyFromCartReview(input.review);
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
