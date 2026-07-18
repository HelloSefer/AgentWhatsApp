import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import { createCartItem, initializeCart } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import { evaluateContextualOrderUnderstanding } from "../../../order-understanding/contextual-order-understanding-eval.service";
import { evaluateItemCollection } from "../item-collection-eval.service";
import { analyzeItemCollectionProgression } from "./item-collection-progression.service";
import type { ItemCollectionProgressionInput } from "./item-collection-progression.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type ItemCollectionProgressionEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "item-progression-seller";
const productId = "item-progression-product";
const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Item Progression Product",
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
  { key: "city", label: "City", required: true, enabled: true, source: "customerField", askOrder: 5, semanticType: "LOCATION" },
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

function withDraft(input: {
  target?: number;
  options?: Record<string, string>;
  quantity?: number;
  quantityExplicitlySet?: boolean;
  productId?: string;
} = {}): CartDraft {
  return {
    ...plannedCart(input.target),
    status: "COLLECTING_ITEM",
    currentItemDraft: createCartItem({
      productId: input.productId || productId,
      status: "DRAFT",
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      selectedOptions: input.options || {},
    }),
  };
}

function withCompleted(input: {
  target?: number;
  items: Array<{ quantity: number; options: Record<string, string> }>;
  status?: CartDraft["status"];
}): CartDraft {
  return {
    ...plannedCart(input.target),
    status: input.status || "COLLECTING_ITEM",
    items: input.items.map((item) => createCartItem({
      productId,
      status: "COMPLETE",
      quantity: item.quantity,
      selectedOptions: item.options,
    })),
  };
}

function input(cart: CartDraft, overrides: Partial<ItemCollectionProgressionInput> = {}): ItemCollectionProgressionInput {
  return { cart, sellerId, productContext, requiredFields: fields, ...overrides };
}

/** Permanent pure regression suite for D2A item progression analysis. */
export async function evaluateItemCollectionProgression(): Promise<ItemCollectionProgressionEvaluationResult> {
  const cases: EvaluationCase[] = [];

  const planned = analyzeItemCollectionProgression(input(plannedCart()));
  add(cases, "planned cart without collection requests collection start", planned.success && planned.step === "START_COLLECTION");

  const sizeFirst = analyzeItemCollectionProgression(input(withDraft()));
  add(cases, "size/color product returns size first when config orders size first", sizeFirst.step === "COLLECT_OPTION" && sizeFirst.field?.key === "size");
  const reversedFields = [{ ...fields[0], askOrder: 2 }, { ...fields[1], askOrder: 1 }, ...fields.slice(2)];
  const colorFirst = analyzeItemCollectionProgression(input(withDraft(), { requiredFields: reversedFields }));
  add(cases, "reversing configured order returns color first", colorFirst.step === "COLLECT_OPTION" && colorFirst.field?.key === "color");
  const afterSize = analyzeItemCollectionProgression(input(withDraft({ options: { size: "38" } })));
  add(cases, "after first option next missing option is returned", afterSize.step === "COLLECT_OPTION" && afterSize.field?.key === "color");
  const afterOptions = analyzeItemCollectionProgression(input(withDraft({ options: { size: "38", color: "black" } })));
  add(cases, "after all options quantity is requested", afterOptions.step === "COLLECT_QUANTITY" && afterOptions.success === false);
  const ready = analyzeItemCollectionProgression(input(withDraft({ options: { size: "38", color: "black" }, quantity: 2 })));
  add(cases, "valid options and explicit quantity return READY_TO_FINALIZE", ready.success && ready.step === "READY_TO_FINALIZE");

  const optionlessFields = fields.filter((field) => field.source === "customerField");
  const optionless = analyzeItemCollectionProgression(input(withDraft(), { requiredFields: optionlessFields }));
  add(cases, "option-less product immediately requests quantity", optionless.step === "COLLECT_QUANTITY");
  const oneOption = analyzeItemCollectionProgression(input(withDraft(), { requiredFields: [fields[1], fields[2], fields[3]] }));
  add(cases, "one-option product requests only that option", oneOption.step === "COLLECT_OPTION" && oneOption.field?.key === "color");
  const customFields: RequiredOrderField[] = [
    { key: "material", label: "Material", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["cotton", "linen"] },
    fields[2],
    fields[3],
  ];
  const custom = analyzeItemCollectionProgression(input(withDraft(), { requiredFields: customFields }));
  add(cases, "custom item option is supported", custom.step === "COLLECT_OPTION" && custom.field?.key === "material");
  const orderFirstFields = [{ ...fields[3], askOrder: 0 }, ...fields.slice(0, 3)];
  const ignoresOrderField = analyzeItemCollectionProgression(input(withDraft(), { requiredFields: orderFirstFields }));
  add(cases, "order-scoped fields are ignored by item progression", ignoresOrderField.step === "COLLECT_OPTION" && ignoresOrderField.field?.key === "size");

  const missing = analyzeItemCollectionProgression(input(withDraft({ options: { color: "black" } })));
  const empty = analyzeItemCollectionProgression(input(withDraft({ options: { size: " ", color: "black" } })));
  const invalid = analyzeItemCollectionProgression(input(withDraft({ options: { size: "42", color: "black" } })));
  const valid = analyzeItemCollectionProgression(input(withDraft({ options: { size: "38", color: "black" } })));
  add(cases, "missing option value is detected", missing.step === "COLLECT_OPTION" && missing.field?.key === "size");
  add(cases, "empty option value is detected", empty.step === "COLLECT_OPTION" && empty.field?.key === "size");
  add(cases, "invalid configured option value is typed", !invalid.success && invalid.step === "COLLECT_OPTION" && invalid.failureCode === "INVALID_ITEM_OPTION_VALUE" && invalid.invalidFields.includes("size"));
  add(cases, "valid configured option value passes", valid.step === "COLLECT_QUANTITY" && !valid.invalidFields.length);
  const openTextFields: RequiredOrderField[] = [
    { key: "engraving", label: "Engraving", required: true, enabled: true, source: "productOption", askOrder: 1 },
    fields[2],
  ];
  const openText = analyzeItemCollectionProgression(input(withDraft({ options: { engraving: "For Omar" }, quantity: 1 }), { requiredFields: openTextFields }));
  add(cases, "open-text item field follows existing config", openText.success && openText.step === "READY_TO_FINALIZE");
  add(cases, "unknown option uses no AI fallback", invalid.failureCode === "INVALID_ITEM_OPTION_VALUE");

  const zero = analyzeItemCollectionProgression(input(withDraft({ options: { size: "38", color: "black" }, quantity: 0 })));
  const excessive = analyzeItemCollectionProgression(input(withDraft({ options: { size: "38", color: "black" }, quantity: 3 })));
  add(cases, "quantity zero is invalid", !zero.success && zero.step === "COLLECT_QUANTITY" && zero.failureCode === "INVALID_ITEM_QUANTITY");
  add(cases, "quantity above remaining target is blocked", !excessive.success && excessive.step === "BLOCKED" && excessive.failureCode === "QUANTITY_EXCEEDS_REMAINING_TARGET");

  const oneLine = analyzeItemCollectionProgression(input(withCompleted({ target: 2, items: [{ quantity: 2, options: { size: "38", color: "black" } }] })));
  const twoLines = analyzeItemCollectionProgression(input(withCompleted({ target: 2, items: [{ quantity: 1, options: { size: "38", color: "black" } }, { quantity: 1, options: { size: "40", color: "black" } }] })));
  add(cases, "one line quantity 2 counts as two completed units", oneLine.progress.completedUnits === 2 && oneLine.step === "CART_REVIEW_READY");
  add(cases, "two lines quantity 1 count as two units", twoLines.progress.completedUnits === 2 && twoLines.step === "CART_REVIEW_READY");
  const incompleteNoDraft = analyzeItemCollectionProgression(input(withCompleted({ target: 2, items: [{ quantity: 1, options: { size: "38", color: "black" } }] })));
  add(cases, "no current draft with incomplete target returns START_NEXT_ITEM", incompleteNoDraft.success && incompleteNoDraft.step === "START_NEXT_ITEM");
  const fulfilledReview = analyzeItemCollectionProgression(input(withCompleted({ target: 2, status: "CART_REVIEW", items: [{ quantity: 2, options: { size: "38", color: "black" } }] })));
  add(cases, "no current draft with fulfilled target returns CART_REVIEW_READY", fulfilledReview.success && fulfilledReview.step === "CART_REVIEW_READY");
  const overfilled = analyzeItemCollectionProgression(input(withCompleted({ target: 2, items: [{ quantity: 3, options: { size: "38", color: "black" } }] })));
  add(cases, "overfilled target is blocked", !overfilled.success && overfilled.step === "BLOCKED" && overfilled.failureCode === "TARGET_OVERFILLED");

  const productMismatch = analyzeItemCollectionProgression(input(withDraft(), { productContext: { ...productContext, productId: "other-product" } }));
  add(cases, "product mismatch returns typed failure", !productMismatch.success && productMismatch.failureCode === "PRODUCT_MISMATCH");
  const invalidCart = { ...withDraft(), schemaVersion: 2 } as unknown as CartDraft;
  const invalidIntegrity = analyzeItemCollectionProgression(input(invalidCart));
  add(cases, "invalid cart integrity is blocked", !invalidIntegrity.success && invalidIntegrity.step === "BLOCKED" && invalidIntegrity.failureCode === "INVALID_CART");
  for (const status of ["CONFIRMED", "CANCELLED", "COLLECTING_DELIVERY", "AWAITING_CONFIRMATION"] as const) {
    const cart = plannedCart();
    cart.status = status;
    const output = analyzeItemCollectionProgression(input(cart));
    add(cases, `${status} lifecycle is blocked`, !output.success && output.step === "BLOCKED" && output.failureCode === "UNSAFE_CART_STATE");
  }

  const immutableCart = withDraft({ options: { size: "38", color: "black" }, quantity: 1 });
  const immutableCartBefore = JSON.stringify(immutableCart);
  const immutableFieldsBefore = JSON.stringify(fields);
  const first = analyzeItemCollectionProgression(input(immutableCart));
  const second = analyzeItemCollectionProgression(input(immutableCart));
  add(cases, "analysis does not mutate cart", JSON.stringify(immutableCart) === immutableCartBefore);
  add(cases, "analysis does not mutate product config or requirements", JSON.stringify(fields) === immutableFieldsBefore && productContext.productId === productId);
  add(cases, "repeated analysis is deterministic", JSON.stringify(first) === JSON.stringify(second));

  const progressionSource = readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", "progression", "item-collection-progression.service.ts"), "utf8");
  add(cases, "no item-collection mutation command is executed", !/\b(?:startItemCollection|setCurrentItemCollectionOption|setCurrentItemCollectionQuantity|finalizeCurrentItemCollection|startNextItemCollection)\b/.test(progressionSource));
  add(cases, "progression has no AI, WhatsApp, renderer, pricing, receipt, DB, or Valkey dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|whatsapp|cloud|renderer|pricing|commercial|receipt|valkey|redis|database|prisma|typeorm|bull|queue)/i.test(progressionSource));

  const d1 = await evaluateItemCollection();
  const cartRegression = await evaluateContextualOrderUnderstanding();
  add(cases, "D1 regression remains passing", d1.failed === 0);
  add(cases, "cart regression remains passing", cartRegression.summary.failed === 0);

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
