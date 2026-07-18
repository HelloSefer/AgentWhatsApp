import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import { evaluateItemCollection } from "../item-collection-eval.service";
import { evaluateItemCollectionProgression } from "../progression/item-collection-progression-eval.service";
import type { ItemCollectionProgressionResult } from "../progression/item-collection-progression.types";
import {
  buildItemCollectionOptionActionId,
  buildItemCollectionPresentation,
} from "./item-collection-presentation.service";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type ItemCollectionPresentationEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const fields: RequiredOrderField[] = [
  { key: "size", label: "Taille", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["36", "37", "38"] },
  { key: "color", label: "Couleur", required: true, enabled: true, source: "productOption", askOrder: 2, options: ["black", "white", "pink"] },
  { key: "quantity", label: "Quantité", required: true, enabled: true, source: "customerField", askOrder: 3, semanticType: "QUANTITY" },
  { key: "fullName", label: "Nom", required: true, enabled: true, source: "customerField", askOrder: 4, semanticType: "PERSON_NAME" },
];

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

function progression(
  step: ItemCollectionProgressionResult["step"],
  overrides: Partial<ItemCollectionProgressionResult> = {},
): ItemCollectionProgressionResult {
  return {
    success: true,
    step,
    progress: { targetUnits: 2, completedUnits: 0, remainingUnits: 2, currentItemNumber: 1 },
    invalidFields: [],
    warnings: [],
    ...overrides,
  };
}

function optionProgression(key: string, overrides: Partial<ItemCollectionProgressionResult> = {}): ItemCollectionProgressionResult {
  return progression("COLLECT_OPTION", {
    field: { key, label: key, required: true, configuredOrder: 1 },
    ...overrides,
  });
}

/** Permanent read-only regression suite for D2B presentation metadata. */
export async function evaluateItemCollectionPresentation(): Promise<ItemCollectionPresentationEvaluationResult> {
  const cases: EvaluationCase[] = [];
  const displayLabels = { black: "أسود", white: "Blanc", pink: "Pink" };

  const size = buildItemCollectionPresentation({ progression: optionProgression("size"), requiredFields: fields });
  add(cases, "size field with three values produces buttons", size.success && size.kind === "OPTION_BUTTONS" && size.uiHints?.kind === "buttons" && size.uiHints.options?.length === 3);
  const sizeFourFields = [{ ...fields[0], options: ["36", "37", "38", "39"] }, ...fields.slice(1)];
  const sizeList = buildItemCollectionPresentation({ progression: optionProgression("size"), requiredFields: sizeFourFields });
  add(cases, "size field with four values produces a list", sizeList.success && sizeList.kind === "OPTION_LIST" && sizeList.uiHints?.kind === "list" && sizeList.uiHints.options?.length === 4);
  const color = buildItemCollectionPresentation({ progression: optionProgression("color"), requiredFields: fields, optionDisplayLabels: displayLabels });
  add(cases, "color field with three values produces buttons", color.success && color.kind === "OPTION_BUTTONS" && color.uiHints?.kind === "buttons");
  add(cases, "configured option ordering is preserved", color.uiHints?.options?.map((option) => option.value).join(",") === "black,white,pink");
  add(cases, "canonical value is used in action ID", color.uiHints?.options?.[0]?.id === "cart_item_option:color:black");
  add(cases, "display label is used in UI title", color.uiHints?.options?.[0]?.label === "أسود");
  add(cases, "action ID does not use display label as authority", !color.uiHints?.options?.[0]?.id.includes("أسود"));
  add(cases, "Arabic display labels are preserved", color.uiHints?.options?.[0]?.label === "أسود");
  add(cases, "French and English labels are preserved", color.uiHints?.options?.[1]?.label === "Blanc" && color.uiHints?.options?.[2]?.label === "Pink");

  const longArabic = "خ".repeat(40) + "🙂";
  const longLabel = buildItemCollectionPresentation({
    progression: optionProgression("color"),
    requiredFields: fields,
    optionDisplayLabels: { black: longArabic, white: "White", pink: "Pink" },
  }).uiHints?.options?.[0]?.label || "";
  add(cases, "long labels are safely bounded", Array.from(longLabel).length <= 24 && longLabel.endsWith("…"));
  add(cases, "Unicode truncation remains valid", !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(longLabel));

  const duplicateFields = [{ ...fields[1], options: ["black", "black"] }, ...fields.filter((field) => field.key !== "color")];
  const duplicate = buildItemCollectionPresentation({ progression: optionProgression("color"), requiredFields: duplicateFields });
  add(cases, "duplicate action IDs are rejected", !duplicate.success && duplicate.kind === "BLOCKED" && duplicate.failureCode === "DUPLICATE_ACTION_ID");
  const unsafeKeyFields = [{ ...fields[0], key: "size:unsafe" }, ...fields.slice(1)];
  const unsafeKey = buildItemCollectionPresentation({ progression: optionProgression("size:unsafe"), requiredFields: unsafeKeyFields });
  add(cases, "unsafe field key is rejected", !unsafeKey.success && unsafeKey.failureCode === "UNSAFE_ACTION_ID");
  const unsafeValueFields = [{ ...fields[0], options: ["size 38"] }, ...fields.slice(1)];
  const unsafeValue = buildItemCollectionPresentation({ progression: optionProgression("size"), requiredFields: unsafeValueFields });
  add(cases, "unsafe canonical value is rejected", !unsafeValue.success && unsafeValue.failureCode === "UNSAFE_ACTION_ID");

  const openTextFields: RequiredOrderField[] = [
    { key: "engraving", label: "Gravure", required: true, enabled: true, source: "productOption", askOrder: 1 },
    fields[2],
  ];
  const openText = buildItemCollectionPresentation({ progression: optionProgression("engraving"), requiredFields: openTextFields });
  add(cases, "open-text item field returns OPTION_TEXT_INPUT", openText.success && openText.kind === "OPTION_TEXT_INPUT" && openText.promptKey === "ENTER_ITEM_OPTION");
  add(cases, "open-text field produces no fake options", !openText.uiHints && openText.field?.key === "engraving");

  const quantityProgression = progression("COLLECT_QUANTITY", { success: false, failureCode: "INVALID_ITEM_QUANTITY" });
  const quantityBefore = JSON.stringify(quantityProgression);
  const quantity = buildItemCollectionPresentation({ progression: quantityProgression, requiredFields: fields });
  add(cases, "COLLECT_QUANTITY returns quantity metadata", quantity.kind === "QUANTITY_INPUT" && quantity.promptKey === "SELECT_ITEM_QUANTITY");
  add(cases, "quantity presentation does not mutate quantity state", JSON.stringify(quantityProgression) === quantityBefore);
  add(cases, "quantity metadata includes remaining units", quantity.progress.remainingUnits === 2 && quantity.itemNumber === 1);

  const ready = buildItemCollectionPresentation({ progression: progression("READY_TO_FINALIZE"), requiredFields: fields });
  add(cases, "READY_TO_FINALIZE returns metadata only", ready.kind === "READY_TO_FINALIZE" && !ready.uiHints && ready.promptKey === "CURRENT_ITEM_READY");
  const next = buildItemCollectionPresentation({ progression: progression("START_NEXT_ITEM", { progress: { targetUnits: 3, completedUnits: 1, remainingUnits: 2 } }), requiredFields: fields });
  add(cases, "START_NEXT_ITEM returns item-number metadata", next.kind === "START_NEXT_ITEM" && next.itemNumber === 2);
  const review = buildItemCollectionPresentation({ progression: progression("CART_REVIEW_READY", { progress: { targetUnits: 2, completedUnits: 2, remainingUnits: 0 } }), requiredFields: fields });
  add(cases, "CART_REVIEW_READY returns metadata only", review.kind === "CART_REVIEW_READY" && !review.uiHints);
  const start = buildItemCollectionPresentation({ progression: progression("START_COLLECTION"), requiredFields: fields });
  add(cases, "START_COLLECTION returns safe metadata", start.kind === "START_COLLECTION" && start.promptKey === "START_COLLECTION" && !start.uiHints);
  const blocked = buildItemCollectionPresentation({ progression: progression("BLOCKED", { success: false, failureCode: "INVALID_CART" }), requiredFields: fields });
  add(cases, "BLOCKED progression returns typed failure", !blocked.success && blocked.kind === "BLOCKED" && blocked.failureCode === "INVALID_CART");
  const optionless = buildItemCollectionPresentation({ progression: progression("COLLECT_QUANTITY"), requiredFields: fields.filter((field) => field.source === "customerField") });
  add(cases, "option-less product never produces fake option prompts", optionless.kind === "QUANTITY_INPUT" && !optionless.uiHints);
  const orderFirstFields = [{ ...fields[3], askOrder: 0 }, ...fields.slice(0, 3)];
  const ignoresOrder = buildItemCollectionPresentation({ progression: optionProgression("size"), requiredFields: orderFirstFields });
  add(cases, "order-scoped fields are never presented as item options", ignoresOrder.success && ignoresOrder.field?.key === "size");

  const immutableProgression = optionProgression("color");
  const immutableFields = JSON.stringify(fields);
  const immutableProgressionBefore = JSON.stringify(immutableProgression);
  const immutableFirst = buildItemCollectionPresentation({ progression: immutableProgression, requiredFields: fields, optionDisplayLabels: displayLabels });
  const immutableSecond = buildItemCollectionPresentation({ progression: immutableProgression, requiredFields: fields, optionDisplayLabels: displayLabels });
  add(cases, "result does not mutate cart/progression input", JSON.stringify(immutableProgression) === immutableProgressionBefore);
  add(cases, "result does not mutate config", JSON.stringify(fields) === immutableFields);
  add(cases, "repeated calls are deterministic", JSON.stringify(immutableFirst) === JSON.stringify(immutableSecond));
  add(cases, "action ID builder uses only safe canonical segments", buildItemCollectionOptionActionId("color", "black") === "cart_item_option:color:black" && !buildItemCollectionOptionActionId("color", "black white"));

  const source = readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", "presentation", "item-collection-presentation.service.ts"), "utf8");
  add(cases, "no action execution occurs", !/\b(?:startItemCollection|setCurrentItemCollectionOption|setCurrentItemCollectionQuantity|finalizeCurrentItemCollection|startNextItemCollection)\b/.test(source));
  add(cases, "presentation has no AI, Cloud transport, pricing, receipt, Valkey, DB, or queue dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|whatsapp|cloud|pricing|commercial|receipt|valkey|redis|database|prisma|typeorm|bull|queue)/i.test(source));

  const d2a = await evaluateItemCollectionProgression();
  const d1 = await evaluateItemCollection();
  add(cases, "D2A regression remains passing", d2a.failed === 0);
  add(cases, "D1 regression remains passing", d1.failed === 0);

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
