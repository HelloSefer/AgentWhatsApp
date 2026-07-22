import { orderMessage } from "../../../conversation-engine/adapters/order-conversation.adapter";
import { arMaItemReference } from "../../../conversation-engine/locales/ar-MA/formatters";

export type PlannedItemOptionDisplay = {
  label: string;
  value: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatPlannedPieceCount(count: number): string {
  if (count === 1) return orderMessage("order.planned_count_one");
  if (count === 2) return orderMessage("order.planned_count_two");
  return orderMessage("order.planned_count_many", { itemCount: count });
}

function slotLabel(slotNumber: number): string {
  if (slotNumber === 1) return orderMessage("order.item_label_first");
  if (slotNumber === 2) return orderMessage("order.item_label_second");
  if (slotNumber === 3) return orderMessage("order.item_label_third");
  return orderMessage("order.item_label_number", { itemCount: slotNumber });
}

function slotReference(slotNumber: number): string {
  return arMaItemReference(slotNumber - 1);
}

function selectedOptionsLines(options: readonly PlannedItemOptionDisplay[]): string[] {
  return options
    .map((option) => ({ label: cleanText(option.label), value: cleanText(option.value) }))
    .filter((option) => option.label && option.value)
    .map((option) => orderMessage("order.selected_option_line", {
      optionLabel: option.label,
      optionValue: option.value,
    }));
}

export function buildInitialPlannedPieceCopy(input: {
  plannedPieceCount: number;
  optionPrompt: string;
}): string {
  return orderMessage(
    input.plannedPieceCount === 1
      ? "order.initial_item_prompt_one"
      : "order.initial_item_prompt_many",
    input.plannedPieceCount === 1
      ? { optionPrompt: cleanText(input.optionPrompt) }
      : {
          pieceCountText: formatPlannedPieceCount(input.plannedPieceCount),
          optionPrompt: cleanText(input.optionPrompt),
        },
  );
}

export function buildSameOrDifferentCopy(input: {
  plannedPieceCount: number;
  completedPieceCount: number;
  selectedOptions: readonly PlannedItemOptionDisplay[];
}): string {
  const nextSlot = input.completedPieceCount + 1;
  const optionLines = selectedOptionsLines(input.selectedOptions);
  return [
    orderMessage("order.completed_item", { itemLabel: slotLabel(input.completedPieceCount) }),
    ...optionLines,
    ...(optionLines.length ? [""] : []),
    orderMessage("order.next_item_same_or_different", { nextItemReference: slotReference(nextSlot) }),
  ].join("\n");
}

export function buildDifferentChoicesCopy(input: {
  currentSlotNumber: number;
  optionPrompt: string;
}): string {
  if (input.currentSlotNumber === 2) {
    return orderMessage("order.different_second_item");
  }

  return orderMessage("order.different_next_item", {
    itemLabel: slotLabel(input.currentSlotNumber),
    optionPrompt: cleanText(input.optionPrompt),
  });
}

export function buildSameAsPreviousCopy(input: {
  plannedPieceCount: number;
  completedPieceCount: number;
}): string {
  const added = orderMessage("order.same_as_previous_added", {
    itemLabel: slotLabel(input.completedPieceCount),
  });
  if (input.completedPieceCount >= input.plannedPieceCount) return added;
  return `${added}\n\n${orderMessage("order.next_item_same_or_different", {
    nextItemReference: slotReference(input.completedPieceCount + 1),
  })}`;
}

export function buildCartReviewIntroduction(plannedPieceCount: number): string {
  if (plannedPieceCount === 1) {
    return orderMessage("order.cart_completion_one");
  }
  return orderMessage("order.cart_completion_many", {
    pieceCountText: formatPlannedPieceCount(plannedPieceCount),
  });
}

/** Completion context only. The cart-review presentation owns its own prompt. */
export function buildCartReviewCompletionCopy(plannedPieceCount: number): string {
  return plannedPieceCount === 1
    ? orderMessage("order.cart_completion_short_one")
    : orderMessage("order.cart_completion_short_many", {
        pieceCountText: formatPlannedPieceCount(plannedPieceCount),
      });
}
