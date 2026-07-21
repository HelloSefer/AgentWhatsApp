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
  if (count === 1) return "قطعة وحدة";
  if (count === 2) return "جوج قطع";
  return `${count} قطع`;
}

function slotLabel(slotNumber: number): string {
  if (slotNumber === 1) return "القطعة الأولى";
  if (slotNumber === 2) return "القطعة الثانية";
  if (slotNumber === 3) return "القطعة الثالثة";
  return `القطعة رقم ${slotNumber}`;
}

function slotReference(slotNumber: number): string {
  return slotLabel(slotNumber).replace(/^ال/u, "لل");
}

function selectedOptionsLines(options: readonly PlannedItemOptionDisplay[]): string[] {
  return options
    .map((option) => ({ label: cleanText(option.label), value: cleanText(option.value) }))
    .filter((option) => option.label && option.value)
    .map((option) => `• ${option.label}: ${option.value}`);
}

export function buildInitialPlannedPieceCopy(input: {
  plannedPieceCount: number;
  optionPrompt: string;
}): string {
  const start = input.plannedPieceCount === 1 ? "نبدأو بها" : "نبدأو بالقطعة الأولى";
  return [
    `تمام 👌 غادي نوجد ليك ${formatPlannedPieceCount(input.plannedPieceCount)}.`,
    `${start}: ${cleanText(input.optionPrompt)}`,
  ].join("\n");
}

export function buildSameOrDifferentCopy(input: {
  plannedPieceCount: number;
  completedPieceCount: number;
  selectedOptions: readonly PlannedItemOptionDisplay[];
}): string {
  const nextSlot = input.completedPieceCount + 1;
  const optionLines = selectedOptionsLines(input.selectedOptions);
  return [
    `مزيان 👌 وجدنا ${slotLabel(input.completedPieceCount)}:`,
    ...optionLines,
    ...(optionLines.length ? [""] : []),
    `دابا بالنسبة ${slotReference(nextSlot)}، بغيتيها بنفس الاختيارات ولا باختيارات مختلفة؟`,
  ].join("\n");
}

export function buildDifferentChoicesCopy(input: {
  currentSlotNumber: number;
  optionPrompt: string;
}): string {
  if (input.currentSlotNumber === 2) {
    return "واخا 👌 بالنسبة للثانية، شنو المقاس اللي بغيتي ليها؟";
  }

  return [
    `واخا 👌 نخليو ${slotLabel(input.currentSlotNumber)} باختيارات مختلفة.`,
    cleanText(input.optionPrompt),
  ].join("\n");
}

export function buildSameAsPreviousCopy(input: {
  plannedPieceCount: number;
  completedPieceCount: number;
}): string {
  const added = `تمام 👌 ضفنا ${slotLabel(input.completedPieceCount)} بنفس الاختيارات.`;
  if (input.completedPieceCount >= input.plannedPieceCount) return added;
  return `${added}\n\nدابا بالنسبة ${slotReference(input.completedPieceCount + 1)}، بغيتيها بنفس الاختيارات ولا باختيارات مختلفة؟`;
}

export function buildCartReviewIntroduction(plannedPieceCount: number): string {
  if (plannedPieceCount === 1) {
    return "مزيان 👌 وجدنا ليك القطعة. راجع الطلب ديالك قبل ما نكملو.";
  }
  return `مزيان 👌 وجدنا ليك ${formatPlannedPieceCount(plannedPieceCount)}. راجع السلة ديالك قبل ما نكملو.`;
}

/** Completion context only. The cart-review presentation owns its own prompt. */
export function buildCartReviewCompletionCopy(plannedPieceCount: number): string {
  return plannedPieceCount === 1
    ? "مزيان 👌 وجدنا ليك القطعة."
    : `مزيان 👌 وجدنا ليك ${formatPlannedPieceCount(plannedPieceCount)}.`;
}
