import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import { initializeCart } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import { evaluateItemOptionActions } from "../actions/item-option-action-eval.service";
import { evaluateItemCollection } from "../item-collection-eval.service";
import { evaluateItemCollectionPreview } from "../preview/item-collection-preview-eval.service";
import { runItemCollectionPreview } from "../preview/item-collection-preview.service";
import { evaluateItemCollectionPresentation } from "../presentation/item-collection-presentation-eval.service";
import { evaluateItemCollectionProgression } from "../progression/item-collection-progression-eval.service";
import { evaluateCartPlanningPreview } from "../../planning/preview/cart-planning-preview-eval.service";
import { evaluateCartQuantityInput } from "../../planning/quantity/cart-quantity-input-eval.service";
import type { ItemCollectionPreviewInput } from "../preview/item-collection-preview.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type ItemCollectionLoopEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "item-loop-seller";
const productId = "item-loop-product";
const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Item Loop Product",
  price: 199,
  currency: "MAD",
  active: true,
  images: [],
  benefits: [],
  optionGroups: [],
  infoMenu: [],
  stock: { enabled: false, status: "AVAILABLE" },
};

const fields: RequiredOrderField[] = [
  { key: "size", label: "Size", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["38", "40"] },
  { key: "color", label: "Color", required: true, enabled: true, source: "productOption", askOrder: 2, options: ["black", "pink"] },
  { key: "quantity", label: "Quantity", required: true, enabled: true, source: "customerField", askOrder: 3, semanticType: "QUANTITY" },
  { key: "fullName", label: "Name", required: true, enabled: true, source: "customerField", askOrder: 4, semanticType: "PERSON_NAME" },
];

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

function plannedCart(targetItemCount = 2): CartDraft {
  return {
    ...initializeCart(),
    mode: "STANDARD",
    status: "PLANNING",
    targetItemCount,
  };
}

function input(overrides: Partial<ItemCollectionPreviewInput> = {}): ItemCollectionPreviewInput {
  return {
    previewEnabled: true,
    sellerId,
    productContext,
    requiredFields: fields,
    cart: plannedCart(),
    ...overrides,
  };
}

function start(cart = plannedCart(), requiredFields = fields) {
  return runItemCollectionPreview(input({ cart, requiredFields }));
}

function option(cart: CartDraft, actionId: string, requiredFields = fields) {
  return runItemCollectionPreview(input({ cart, requiredFields, rawActionId: actionId }));
}

function quantity(cart: CartDraft, text: unknown, requiredFields = fields) {
  return runItemCollectionPreview(input({ cart, requiredFields, itemCollectionText: text }));
}

function collectOptions(cart: CartDraft, values: { size?: string; color?: string }, requiredFields = fields): CartDraft {
  let current = cart;
  if (values.size) current = option(current, `cart_item_option:size:${values.size}`, requiredFields).cartAfter;
  if (values.color) current = option(current, `cart_item_option:color:${values.color}`, requiredFields).cartAfter;
  return current;
}

function cloneCart(cart: CartDraft): CartDraft {
  return {
    ...cart,
    items: cart.items.map((item) => ({ ...item, selectedOptions: { ...item.selectedOptions } })),
    currentItemDraft: cart.currentItemDraft
      ? { ...cart.currentItemDraft, selectedOptions: { ...cart.currentItemDraft.selectedOptions } }
      : undefined,
    orderLevelFields: { ...cart.orderLevelFields },
  };
}

/** Permanent preview-only vertical regression suite for the D2D item loop. */
export async function evaluateItemCollectionLoop(): Promise<ItemCollectionLoopEvaluationResult> {
  const cases: EvaluationCase[] = [];

  const started = start();
  add(cases, "existing D2D1 startup remains working", started.success && started.progression?.field?.key === "size" && Boolean(started.cartAfter.currentItemDraft));
  const firstOptions = collectOptions(started.cartAfter, { size: "38", color: "black" });
  const firstCompleted = quantity(firstOptions, "1");
  add(cases, "size color target two finalizes first item", firstCompleted.success && firstCompleted.loopResult?.finalizedItem === true && firstCompleted.cartAfter.items.length === 1);
  add(cases, "first item automatically starts second item", firstCompleted.loopResult?.nextItemStarted === true && firstCompleted.progression?.field?.key === "size" && Boolean(firstCompleted.cartAfter.currentItemDraft));
  const secondOptions = collectOptions(firstCompleted.cartAfter, { size: "40", color: "pink" });
  const secondCompleted = quantity(secondOptions, "1");
  add(cases, "second item quantity one reaches cart review readiness", secondCompleted.success && secondCompleted.nextStep === "CART_REVIEW_READY" && secondCompleted.progression?.step === "CART_REVIEW_READY");
  add(cases, "final result contains two different items", secondCompleted.cartAfter.items.length === 2 && secondCompleted.cartAfter.items[0].selectedOptions.size !== secondCompleted.cartAfter.items[1].selectedOptions.size && secondCompleted.cartAfter.items[0].selectedOptions.color !== secondCompleted.cartAfter.items[1].selectedOptions.color);
  add(cases, "progress uses quantities rather than line count", secondCompleted.progression?.progress.completedUnits === 2 && secondCompleted.progression.progress.remainingUnits === 0);

  const oneLineStart = start(plannedCart(2));
  const oneLineOptions = collectOptions(oneLineStart.cartAfter, { size: "38", color: "black" });
  const oneLine = quantity(oneLineOptions, "2");
  add(cases, "one configured variant quantity two fulfills target in one line", oneLine.success && oneLine.cartAfter.items.length === 1 && oneLine.cartAfter.items[0].quantity === 2 && oneLine.nextStep === "CART_REVIEW_READY");

  const mergeStart = start(plannedCart(2));
  const mergeFirst = quantity(collectOptions(mergeStart.cartAfter, { size: "38", color: "black" }), "1");
  const mergeSecond = quantity(collectOptions(mergeFirst.cartAfter, { size: "38", color: "black" }), "1");
  add(cases, "two identical quantity one items may merge", mergeSecond.success && mergeSecond.cartAfter.items.length === 1 && mergeSecond.cartAfter.items[0].quantity === 2);
  const colorStart = start(plannedCart(2));
  const colorFirst = quantity(collectOptions(colorStart.cartAfter, { size: "38", color: "black" }), "1");
  const colorSecond = quantity(collectOptions(colorFirst.cartAfter, { size: "38", color: "pink" }), "1");
  add(cases, "different color items do not merge", colorSecond.cartAfter.items.length === 2);
  const sizeStart = start(plannedCart(2));
  const sizeFirst = quantity(collectOptions(sizeStart.cartAfter, { size: "38", color: "black" }), "1");
  const sizeSecond = quantity(collectOptions(sizeFirst.cartAfter, { size: "40", color: "black" }), "1");
  add(cases, "different size items do not merge", sizeSecond.cartAfter.items.length === 2);

  const optionlessFields = fields.filter((field) => field.source === "customerField");
  const optionlessStart = start(plannedCart(3), optionlessFields);
  const optionless = quantity(optionlessStart.cartAfter, "3", optionlessFields);
  add(cases, "option-less target three quantity three produces one completed line", optionless.success && optionless.cartAfter.items.length === 1 && optionless.cartAfter.items[0].quantity === 3 && Object.keys(optionless.cartAfter.items[0].selectedOptions).length === 0);
  const oneOptionFields = [fields[1], ...fields.slice(2)];
  const oneOptionStart = start(plannedCart(1), oneOptionFields);
  const oneOption = quantity(option(oneOptionStart.cartAfter, "cart_item_option:color:black", oneOptionFields).cartAfter, "1", oneOptionFields);
  add(cases, "one-option product completes correctly", oneOption.success && oneOption.cartAfter.items.length === 1 && oneOption.cartAfter.items[0].selectedOptions.color === "black");
  const customFields: RequiredOrderField[] = [
    { key: "material", label: "Material", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["cotton", "linen"] },
    fields[2],
  ];
  const customStart = start(plannedCart(1), customFields);
  const custom = quantity(option(customStart.cartAfter, "cart_item_option:material:linen", customFields).cartAfter, "1", customFields);
  add(cases, "custom closed-list option completes correctly", custom.success && custom.cartAfter.items[0].selectedOptions.material === "linen");

  const quantityWhileOptionRequired = quantity(started.cartAfter, "1");
  add(cases, "quantity text during COLLECT_OPTION is not consumed", !quantityWhileOptionRequired.success && quantityWhileOptionRequired.failureCode === "QUANTITY_NOT_CURRENTLY_EXPECTED" && !quantityWhileOptionRequired.cartAfter.currentItemDraft?.quantityExplicitlySet);
  const optionWhileQuantityRequired = option(firstOptions, "cart_item_option:size:40");
  add(cases, "option action during COLLECT_QUANTITY is rejected", !optionWhileQuantityRequired.success && optionWhileQuantityRequired.actionResult?.failureCode === "PROGRESSION_NOT_COLLECTING_OPTION");
  const invalidCases: Array<[string, string]> = [
    ["zero", "0"],
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["phone-like", "0612345678"],
    ["price-like", "199 درهم"],
  ];
  for (const [name, text] of invalidCases) {
    const output = quantity(firstOptions, text);
    add(cases, `${name} quantity is rejected`, !output.success && output.nextStep === "RETRY_ITEM_QUANTITY" && Boolean(output.loopResult?.quantityResult?.failureCode));
  }
  const excessive = quantity(firstOptions, "3");
  add(cases, "quantity above remaining target is rejected", !excessive.success && excessive.failureCode === "QUANTITY_EXCEEDS_REMAINING_TARGET");
  const preserved = quantity(firstOptions, "0");
  add(cases, "invalid quantity preserves draft and options", JSON.stringify(preserved.cartAfter.currentItemDraft?.selectedOptions) === JSON.stringify(firstOptions.currentItemDraft?.selectedOptions) && !preserved.cartAfter.currentItemDraft?.quantityExplicitlySet && preserved.cartAfter.items.length === 0);
  add(cases, "incomplete item cannot finalize", !quantityWhileOptionRequired.success && quantityWhileOptionRequired.cartAfter.items.length === 0);
  add(cases, "target cannot be overfilled", excessive.cartAfter.items.length === 0 && excessive.cartAfter.currentItemDraft?.quantity === 1);
  const replay = quantity(oneLine.cartAfter, "2");
  add(cases, "completed item is not duplicated on replay", !replay.success && replay.cartAfter.items.length === 1 && replay.cartAfter.items[0].quantity === 2);
  const nextReplay = start(firstCompleted.cartAfter);
  add(cases, "current draft is not duplicated on replay", nextReplay.success && !nextReplay.collectionResult?.changed && Boolean(nextReplay.cartAfter.currentItemDraft) && nextReplay.cartAfter.items.length === 1);
  add(cases, "cart review readiness creates no delivery or confirmation state", secondCompleted.cartAfter.status === "CART_REVIEW" && !secondCompleted.cartAfter.currentItemDraft);
  add(cases, "cart review metadata is returned without review actions", secondCompleted.presentation?.promptKey === "CART_REVIEW_READY" && !secondCompleted.presentation?.uiHints);

  const scoped = plannedCart(1);
  scoped.mode = "OFFER";
  scoped.selectedOfferId = "offer_two";
  scoped.orderLevelFields = { fullName: "Omar" };
  const scopedStart = start(scoped);
  const scopedFinal = quantity(collectOptions(scopedStart.cartAfter, { size: "38", color: "black" }), "1");
  add(cases, "existing order-level fields remain unchanged", scopedFinal.cartAfter.orderLevelFields.fullName === "Omar");
  add(cases, "selected offer and cart mode remain unchanged", scopedFinal.cartAfter.mode === "OFFER" && scopedFinal.cartAfter.selectedOfferId === "offer_two");
  const immutableInput = plannedCart(1);
  const immutableBefore = JSON.stringify(immutableInput);
  const immutableStarted = start(immutableInput);
  add(cases, "input preview cart is not mutated", JSON.stringify(immutableInput) === immutableBefore);
  add(cases, "returned result is detached", immutableStarted.cartBefore !== immutableInput && immutableStarted.cartAfter !== immutableInput && immutableStarted.cartAfter !== immutableStarted.collectionResult?.cart);

  const loopSource = ["item-collection-loop.types.ts", "item-collection-loop.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", "loop", file), "utf8"))
    .join("\n");
  const quantitySource = ["current-item-quantity.types.ts", "current-item-quantity-normalizer.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", "quantity", file), "utf8"))
    .join("\n");
  add(cases, "loop and quantity have no Valkey or session persistence", !/from\s+["'][^"']*(?:session|valkey|redis|database|prisma|typeorm)/i.test(`${loopSource}\n${quantitySource}`));
  add(cases, "loop and quantity have no AI Cloud Meta pricing receipt DB or queue dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|whatsapp|cloud|meta|pricing|commercial|receipt|valkey|redis|database|prisma|typeorm|bull|queue)/i.test(`${loopSource}\n${quantitySource}`));
  add(cases, "loop owns no global mutable state", !/^(?:let|var)\s+/m.test(loopSource));
  const previewSource = readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", "preview", "item-collection-preview.service.ts"), "utf8");
  add(cases, "preview delegates loop without quantity or finalization commands", previewSource.includes("runItemCollectionLoop") && !/\b(?:setCurrentItemCollectionQuantity|finalizeCurrentItemCollection|startNextItemCollection)\b/.test(previewSource));

  const d2d1 = await evaluateItemCollectionPreview();
  const d2c = await evaluateItemOptionActions();
  const d2b = await evaluateItemCollectionPresentation();
  const d2a = await evaluateItemCollectionProgression();
  const d1 = await evaluateItemCollection();
  const planningPreview = evaluateCartPlanningPreview();
  const planningQuantity = evaluateCartQuantityInput();
  add(cases, "D2D1 regression remains passing", d2d1.failed === 0);
  add(cases, "D2C regression remains passing", d2c.failed === 0);
  add(cases, "D2B regression remains passing", d2b.failed === 0);
  add(cases, "D2A regression remains passing", d2a.failed === 0);
  add(cases, "D1 regression remains passing", d1.failed === 0);
  add(cases, "existing planning preview regression remains passing", planningPreview.failed === 0);
  add(cases, "existing custom target quantity regression remains passing", planningQuantity.failed === 0);

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
