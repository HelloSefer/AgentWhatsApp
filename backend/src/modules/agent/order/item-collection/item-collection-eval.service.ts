import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import { initializeCart } from "../cart-state.service";
import type { CartDraft } from "../cart-state.types";
import { evaluateCartPlanning } from "../planning/cart-planning-eval.service";
import { evaluateContextualOrderUnderstanding } from "../../order-understanding/contextual-order-understanding-eval.service";
import {
  getItemCollectionOptionFields,
  getRequiredItemCollectionFields,
} from "./item-collection-requirements.service";
import {
  finalizeCurrentItemCollection,
  inspectItemCollectionState,
  setCurrentItemCollectionOption,
  setCurrentItemCollectionQuantity,
  startItemCollection,
  startNextItemCollection,
} from "./item-collection.service";
import type { ItemCollectionContext } from "./item-collection.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type ItemCollectionEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "item-collection-seller";
const productId = "item-collection-product";
const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Item Collection Product",
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
    status: "PLANNING",
    mode: "STANDARD",
    targetItemCount,
  };
}

function context(overrides: Partial<ItemCollectionContext> = {}): ItemCollectionContext {
  return { sellerId, productContext, requiredFields: fields, ...overrides };
}

function start(cart: CartDraft, overrides: Partial<ItemCollectionContext> = {}) {
  return startItemCollection({ cart, ...context(overrides) });
}

function setOption(cart: CartDraft, optionKey: string, value: unknown, overrides: Partial<ItemCollectionContext> = {}) {
  return setCurrentItemCollectionOption({ cart, optionKey, value, ...context(overrides) });
}

function setQuantity(cart: CartDraft, quantity: unknown, overrides: Partial<ItemCollectionContext> = {}) {
  return setCurrentItemCollectionQuantity({ cart, quantity, ...context(overrides) });
}

function finalize(cart: CartDraft, overrides: Partial<ItemCollectionContext> = {}) {
  return finalizeCurrentItemCollection({ cart, ...context(overrides) });
}

function completeItem(cart: CartDraft, input: { size?: string; color?: string; quantity: number }): CartDraft {
  let current = cart;
  if (input.size !== undefined) current = setOption(current, "size", input.size).cart;
  if (input.color !== undefined) current = setOption(current, "color", input.color).cart;
  current = setQuantity(current, input.quantity).cart;
  return finalize(current).cart;
}

/** Permanent deterministic regression suite for the isolated D1 collection domain. */
export async function evaluateItemCollection(): Promise<ItemCollectionEvaluationResult> {
  const cases: EvaluationCase[] = [];

  const initial = plannedCart(2);
  const firstStart = start(initial);
  add(cases, "valid planned cart starts collection", firstStart.success && firstStart.cart.status === "COLLECTING_ITEM");
  add(cases, "starting creates exactly one current item draft", firstStart.cart.items.length === 0 && Boolean(firstStart.cart.currentItemDraft) && firstStart.cart.currentItemDraft?.productId === productId);
  const secondStart = start(firstStart.cart);
  add(cases, "starting twice is idempotent", secondStart.success && !secondStart.changed && Boolean(secondStart.cart.currentItemDraft) && secondStart.cart.items.length === 0);

  const noTarget = start({ ...initializeCart(), status: "PLANNING" });
  const zeroTarget = start(plannedCart(0));
  add(cases, "missing targetItemCount is rejected", !noTarget.success && noTarget.failureCode === "MISSING_TARGET_ITEM_COUNT");
  add(cases, "zero or invalid target is rejected", !zeroTarget.success && zeroTarget.failureCode === "INVALID_TARGET_ITEM_COUNT");
  for (const status of ["CONFIRMED", "CANCELLED", "CART_REVIEW", "COLLECTING_DELIVERY", "AWAITING_CONFIRMATION"] as const) {
    const cart = plannedCart();
    cart.status = status;
    const output = start(cart);
    add(cases, `${status} collection is blocked`, !output.success && output.failureCode === "UNSAFE_CART_STATE");
  }

  const required = getRequiredItemCollectionFields(fields);
  add(cases, "required item fields come from dynamic config", required.map((field) => field.key).join(",") === "size,color");
  add(cases, "size/color product returns both required item fields", required.length === 2 && required[0].key === "size" && required[1].key === "color");
  const oneOptionFields: RequiredOrderField[] = [fields[0], fields[2], fields[3]];
  add(cases, "one-option product returns only that field", getRequiredItemCollectionFields(oneOptionFields).map((field) => field.key).join(",") === "size");
  const customFields: RequiredOrderField[] = [
    { key: "material", label: "Material", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["cotton", "linen"] },
    fields[2],
    fields[3],
  ];
  const customStarted = start(plannedCart(1), { requiredFields: customFields });
  const customSet = setOption(customStarted.cart, "material", "linen", { requiredFields: customFields });
  add(cases, "custom item option is supported", customSet.success && customSet.cart.currentItemDraft?.selectedOptions.material === "linen");
  const optionlessFields: RequiredOrderField[] = [fields[2], fields[3], fields[4]];
  add(cases, "option-less product returns no required item fields", getRequiredItemCollectionFields(optionlessFields).length === 0 && getItemCollectionOptionFields(optionlessFields).length === 0);

  const optionSet = setOption(firstStart.cart, "size", "38");
  add(cases, "setting one option affects only the current item draft", optionSet.success && optionSet.cart.items.length === 0 && optionSet.cart.currentItemDraft?.selectedOptions.size === "38");
  const optionRepeated = setOption(optionSet.cart, "size", "38");
  add(cases, "setting the same option twice is idempotent", optionRepeated.success && !optionRepeated.changed);
  const orderField = setOption(optionSet.cart, "city", "Marrakech");
  add(cases, "order-level field cannot be set as an item option", !orderField.success && orderField.failureCode === "ORDER_SCOPED_FIELD");

  const quantitySet = setQuantity(optionSet.cart, 2);
  add(cases, "valid item quantity is accepted", quantitySet.success && quantitySet.changed && quantitySet.cart.currentItemDraft?.quantity === 2);
  const invalidQuantity = setQuantity(optionSet.cart, 0);
  const excessiveQuantity = setQuantity(optionSet.cart, 3);
  add(cases, "invalid quantity is rejected", !invalidQuantity.success && invalidQuantity.failureCode === "INVALID_ITEM_QUANTITY");
  add(cases, "quantity above remaining target is rejected", !excessiveQuantity.success && excessiveQuantity.failureCode === "QUANTITY_EXCEEDS_REMAINING_TARGET");

  const incomplete = finalize(quantitySet.cart);
  add(cases, "incomplete current item cannot finalize", !incomplete.success && incomplete.failureCode === "MISSING_REQUIRED_ITEM_FIELDS" && incomplete.cart.items.length === 0);
  const readyDraft = setOption(setQuantity(setOption(optionSet.cart, "color", "black").cart, 2).cart, "size", "38");
  const finalized = finalize(readyDraft.cart);
  add(cases, "completed current item finalizes successfully", finalized.success && finalized.cart.items.length === 1 && finalized.cart.items[0].quantity === 2);
  add(cases, "finalization clears current item draft", !finalized.cart.currentItemDraft);
  add(cases, "one line with quantity 2 fulfills target 2", finalized.progress.completedUnits === 2 && finalized.progress.remainingUnits === 0 && finalized.nextStep === "CART_REVIEW_READY");
  add(cases, "target fulfilled returns CART_REVIEW_READY", finalized.cart.status === "CART_REVIEW" && finalized.nextStep === "CART_REVIEW_READY");

  const firstLine = completeItem(start(plannedCart(2)).cart, { size: "38", color: "black", quantity: 1 });
  add(cases, "target not fulfilled returns START_NEXT_ITEM", firstLine.status === "COLLECTING_ITEM" && firstLine.items.length === 1);
  const secondItem = startNextItemCollection({ cart: firstLine, ...context() });
  add(cases, "starting next item creates one draft", secondItem.success && Boolean(secondItem.cart.currentItemDraft) && secondItem.nextStep === "COLLECT_CURRENT_ITEM");
  const repeatedNext = startNextItemCollection({ cart: secondItem.cart, ...context() });
  add(cases, "starting next item twice is idempotent", repeatedNext.success && !repeatedNext.changed && Boolean(repeatedNext.cart.currentItemDraft));
  const twoLines = completeItem(secondItem.cart, { size: "40", color: "black", quantity: 1 });
  add(cases, "two lines quantity 1 fulfill target 2", twoLines.items.length === 2 && twoLines.items.every((item) => item.quantity === 1) && twoLines.status === "CART_REVIEW");
  add(cases, "completed items remain isolated when options differ", twoLines.items[0].selectedOptions.size !== twoLines.items[1].selectedOptions.size);

  const mergeFirst = completeItem(start(plannedCart(2)).cart, { size: "38", color: "pink", quantity: 1 });
  const mergeNext = startNextItemCollection({ cart: mergeFirst, ...context() });
  const merged = completeItem(mergeNext.cart, { size: "38", color: "pink", quantity: 1 });
  add(cases, "same options may merge quantities", merged.items.length === 1 && merged.items[0].quantity === 2 && merged.status === "CART_REVIEW");
  add(cases, "progress counts quantities rather than line count", merged.items.length === 1 && inspectItemCollectionState({ cart: merged, ...context() }).progress.completedUnits === 2);

  const optionlessStarted = start(plannedCart(3), { requiredFields: optionlessFields });
  const optionlessQuantity = setQuantity(optionlessStarted.cart, 3, { requiredFields: optionlessFields });
  const optionlessFinal = finalize(optionlessQuantity.cart, { requiredFields: optionlessFields });
  add(cases, "option-less quantity 3 produces one completed line", optionlessFinal.success && optionlessFinal.cart.items.length === 1 && optionlessFinal.cart.items[0].quantity === 3 && Object.keys(optionlessFinal.cart.items[0].selectedOptions).length === 0);

  const withOrderFields = plannedCart(1);
  withOrderFields.orderLevelFields = { fullName: "Omar", city: "Marrakech" };
  const orderFieldsBefore = JSON.stringify(withOrderFields.orderLevelFields);
  const orderFieldsStart = start(withOrderFields);
  add(cases, "existing order-level fields remain unchanged", JSON.stringify(orderFieldsStart.cart.orderLevelFields) === orderFieldsBefore);
  const offerCart = { ...plannedCart(2), mode: "OFFER" as const, selectedOfferId: "offer-two" };
  const offerStarted = start(offerCart);
  add(cases, "selectedOfferId and mode remain unchanged", offerStarted.cart.mode === "OFFER" && offerStarted.cart.selectedOfferId === "offer-two");

  const mismatchedProduct = { ...productContext, productId: "other-product" };
  const mismatch = start(firstStart.cart, { productContext: mismatchedProduct });
  add(cases, "product mismatch is rejected", !mismatch.success && mismatch.failureCode === "PRODUCT_MISMATCH");
  const conversationOne = start(plannedCart(1));
  const conversationTwo = start(plannedCart(1));
  const isolatedOne = setOption(conversationOne.cart, "color", "black");
  add(cases, "seller and conversation state remain isolated", isolatedOne.cart !== conversationTwo.cart && !conversationTwo.cart.currentItemDraft?.selectedOptions.color);

  const mutableCart = plannedCart(1);
  const mutableFields = JSON.stringify(fields);
  const mutableCartBefore = JSON.stringify(mutableCart);
  const detached = start(mutableCart);
  add(cases, "input config and cart objects are not mutated outside the boundary", JSON.stringify(mutableCart) === mutableCartBefore && JSON.stringify(fields) === mutableFields && detached.cart !== mutableCart);

  const cartRegression = await evaluateContextualOrderUnderstanding();
  const planningRegression = evaluateCartPlanning();
  add(cases, "existing cart-domain contextual regression remains passing", cartRegression.summary.failed === 0);
  add(cases, "existing C1 planning regression remains passing", planningRegression.failed === 0);

  const sources = [
    "item-collection.types.ts",
    "item-collection-requirements.service.ts",
    "item-collection.service.ts",
  ].map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", file), "utf8")).join("\n");
  add(cases, "item collection has no AI, pricing, WhatsApp, receipt, DB, or Valkey dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|pricing|commercial|whatsapp|cloud|receipt|database|prisma|typeorm|valkey|redis)/i.test(sources));
  add(cases, "item collection owns no global mutable state", !/^(?:let|var)\s+/m.test(sources));

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
