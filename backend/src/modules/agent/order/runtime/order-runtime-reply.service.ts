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
import {
  orderLabel,
  orderMessage,
} from "../../../conversation-engine/adapters/order-conversation.adapter";
import { commonLabel } from "../../../conversation-engine/adapters/common-conversation.adapter";

export type RuntimeReply = {
  text: string;
  replyUi?: AgentReplyUiHint;
  orderConfirmationPresentation?: OrderConfirmationPresentation;
};

const retryText = orderMessage("error.invalid_selection");

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
  const verb = result.presentation?.kind === "OPTION_TEXT_INPUT"
    ? commonLabel("common.enter")
    : commonLabel("common.select");
  return orderMessage("order.current_option_prompt", { verb, optionLabel: label });
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

  const text = orderMessage("order.piece_count_question_with_size", {
    selectedSize: input.selectedSize,
    productPluralName: input.productPluralName,
  });
  const labels: Record<string, string> = {
    "cart_quantity:1": orderLabel("order.only_this"),
    "cart_quantity:2": orderLabel("order.add_one"),
    "cart_quantity:3": orderLabel("order.add_two"),
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
    return reply(orderMessage("order.custom_quantity_prompt"));
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
        ? { ...interactiveUi, buttonText: orderLabel("order.size_list_button") }
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
    presentation?.text || (result.shortcutPresentation ? orderMessage("order.same_or_different_prompt") : undefined),
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
      ? orderMessage("order.first_item_progress_one", {
          selectedSize: initialItemOptionSummary.selectedSize,
        })
      : plannedPieceCount(result) === 2
        ? orderMessage("order.first_item_progress_two", {
            selectedSize: initialItemOptionSummary.selectedSize,
            productPluralName: initialItemOptionSummary.productPluralName,
          })
        : orderMessage("order.first_item_progress_many", {
            itemCount: plannedPieceCount(result),
            selectedSize: initialItemOptionSummary.selectedSize,
            productPluralName: initialItemOptionSummary.productPluralName,
          });
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
  return { text: orderMessage("error.stale_action") };
}

export function recoveryReply(): RuntimeReply {
  return { text: orderMessage("error.recovery") };
}
