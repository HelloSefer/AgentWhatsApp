import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import { createCartItem, initializeCart } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import { evaluateItemOptionActions } from "../actions/item-option-action-eval.service";
import { evaluateItemCollection } from "../item-collection-eval.service";
import { evaluateItemCollectionPresentation } from "../presentation/item-collection-presentation-eval.service";
import { evaluateItemCollectionProgression } from "../progression/item-collection-progression-eval.service";
import { evaluateCartPlanningPreview } from "../../planning/preview/cart-planning-preview-eval.service";
import { runItemCollectionPreview } from "./item-collection-preview.service";
import type { ItemCollectionPreviewInput } from "./item-collection-preview.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type ItemCollectionPreviewEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "item-preview-seller";
const productId = "item-preview-product";
const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Item Preview Product",
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

function input(
  overrides: Partial<ItemCollectionPreviewInput> = {},
): ItemCollectionPreviewInput {
  return {
    previewEnabled: true,
    sellerId,
    productContext,
    requiredFields: fields,
    cart: plannedCart(),
    ...overrides,
  };
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

/** Permanent isolated regression suite for explicit D2D1 item collection preview. */
export async function evaluateItemCollectionPreview(): Promise<ItemCollectionPreviewEvaluationResult> {
  const cases: EvaluationCase[] = [];

  const disabledCart = plannedCart();
  const disabled = runItemCollectionPreview(input({ previewEnabled: false, cart: disabledCart }));
  add(cases, "preview disabled leaves behavior unhandled", !disabled.handled && disabled.route === "NOT_HANDLED" && JSON.stringify(disabled.cartAfter) === JSON.stringify(disabledCart));

  const initial = plannedCart();
  const initialBefore = JSON.stringify(initial);
  const started = runItemCollectionPreview(input({ cart: initial }));
  add(cases, "valid planned cart starts collection", started.handled && started.success && started.route === "COLLECTION_STARTED");
  add(cases, "starting creates exactly one current item draft", started.cartAfter.items.length === 0 && Boolean(started.cartAfter.currentItemDraft));
  add(cases, "size color product presents first configured option", started.progression?.field?.key === "size" && started.presentation?.promptKey === "SELECT_ITEM_OPTION");
  add(cases, "input preview cart is not mutated", JSON.stringify(initial) === initialBefore);
  add(cases, "returned cart is detached", started.cartBefore !== initial && started.cartAfter !== initial && started.cartAfter !== started.collectionResult?.cart);
  const repeatedStart = runItemCollectionPreview(input({ cart: started.cartAfter }));
  add(cases, "starting twice is idempotent", repeatedStart.success && !repeatedStart.collectionResult?.changed && Boolean(repeatedStart.cartAfter.currentItemDraft));

  const reversedFields = [{ ...fields[1], askOrder: 1 }, { ...fields[0], askOrder: 2 }, ...fields.slice(2)];
  const reversed = runItemCollectionPreview(input({ requiredFields: reversedFields }));
  add(cases, "reversed configured order presents configured first field", reversed.progression?.field?.key === "color");
  const firstOption = runItemCollectionPreview(input({ cart: started.cartAfter, rawActionId: "cart_item_option:size:38" }));
  add(cases, "valid first option action advances to next option", firstOption.success && firstOption.route === "OPTION_ACTION" && firstOption.progression?.field?.key === "color");
  const lastOption = runItemCollectionPreview(input({ cart: firstOption.cartAfter, rawActionId: "cart_item_option:color:black" }));
  add(cases, "last required option advances to COLLECT_QUANTITY", lastOption.success && lastOption.route === "QUANTITY_REQUIRED" && lastOption.progression?.step === "COLLECT_QUANTITY");
  add(cases, "D2B quantity metadata is returned", lastOption.presentation?.promptKey === "SELECT_ITEM_QUANTITY" && lastOption.nextStep === "ENTER_ITEM_QUANTITY");
  add(cases, "quantity stop boundary leaves default quantity uncollected", lastOption.cartAfter.currentItemDraft?.quantity === 1 && !lastOption.cartAfter.currentItemDraft?.quantityExplicitlySet);
  add(cases, "no item finalization occurs", lastOption.cartAfter.items.length === 0 && Boolean(lastOption.cartAfter.currentItemDraft));
  add(cases, "no next item is started", lastOption.cartAfter.currentItemDraft?.productId === productId && lastOption.cartAfter.status === "COLLECTING_ITEM");
  add(cases, "no cart review transition occurs", lastOption.cartAfter.status !== "CART_REVIEW");

  const optionlessFields = fields.filter((field) => field.source === "customerField");
  const optionless = runItemCollectionPreview(input({ requiredFields: optionlessFields, cart: plannedCart(1) }));
  add(cases, "option-less product immediately returns quantity metadata", optionless.success && optionless.route === "QUANTITY_REQUIRED" && optionless.presentation?.promptKey === "SELECT_ITEM_QUANTITY" && !optionless.presentation.uiHints);
  const oneOptionFields = [fields[1], ...fields.slice(2)];
  const oneOption = runItemCollectionPreview(input({ requiredFields: oneOptionFields, cart: plannedCart(1) }));
  add(cases, "one-option product requires only that option", oneOption.progression?.field?.key === "color");
  const customFields: RequiredOrderField[] = [
    { key: "material", label: "Material", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["cotton", "linen"] },
    fields[2],
  ];
  const customStart = runItemCollectionPreview(input({ requiredFields: customFields, cart: plannedCart(1) }));
  const customAction = runItemCollectionPreview(input({ requiredFields: customFields, cart: customStart.cartAfter, rawActionId: "cart_item_option:material:linen" }));
  add(cases, "custom closed-list option works", customAction.success && customAction.cartAfter.currentItemDraft?.selectedOptions.material === "linen" && customAction.route === "QUANTITY_REQUIRED");

  const wrongField = runItemCollectionPreview(input({ cart: started.cartAfter, rawActionId: "cart_item_option:color:black" }));
  const unknownValue = runItemCollectionPreview(input({ cart: started.cartAfter, rawActionId: "cart_item_option:size:42" }));
  add(cases, "wrong-field action is rejected through D2C", wrongField.handled && !wrongField.success && wrongField.actionResult?.failureCode === "FIELD_NOT_CURRENTLY_EXPECTED");
  add(cases, "unknown configured value is rejected through D2C", unknownValue.handled && !unknownValue.success && unknownValue.actionResult?.failureCode === "CANONICAL_VALUE_NOT_CONFIGURED");
  const openTextFields: RequiredOrderField[] = [
    { key: "engraving", label: "Engraving", required: true, enabled: true, source: "productOption", askOrder: 1 },
    fields[2],
  ];
  const openTextStart = runItemCollectionPreview(input({ requiredFields: openTextFields, cart: plannedCart(1) }));
  const openText = runItemCollectionPreview(input({ requiredFields: openTextFields, cart: openTextStart.cartAfter, rawActionId: "cart_item_option:engraving:hello" }));
  add(cases, "open-text option action remains deferred", !openText.success && openText.actionResult?.failureCode === "OPEN_TEXT_ACTION_NOT_SUPPORTED");
  for (const rawActionId of ["confirm:yes", "info:price", "cart_offer:offer_2", "cart_quantity:2", "size:38", "normal text"]) {
    const output = runItemCollectionPreview(input({ rawActionId }));
    add(cases, `${rawActionId} is not consumed`, !output.handled && output.route === "NOT_HANDLED");
  }

  for (const status of ["CONFIRMED", "CART_REVIEW", "COLLECTING_DELIVERY"] as const) {
    const cart = cloneCart(started.cartAfter);
    cart.status = status;
    if (status !== "COLLECTING_DELIVERY") cart.currentItemDraft = undefined;
    const output = runItemCollectionPreview(input({ cart }));
    add(cases, `${status} lifecycle failure propagates`, !output.success && output.route === "BLOCKED");
  }
  const completed = plannedCart(2);
  completed.status = "COLLECTING_ITEM";
  completed.items = [createCartItem({ id: "completed-item", productId, quantity: 1, selectedOptions: { size: "38", color: "black" }, status: "COMPLETE" })];
  const completedOutput = runItemCollectionPreview(input({ cart: completed }));
  add(cases, "existing completed items are not erased", completedOutput.success && completedOutput.cartAfter.items.length === 1 && Boolean(completedOutput.cartAfter.currentItemDraft));
  const orderFieldsCart = cloneCart(started.cartAfter);
  orderFieldsCart.orderLevelFields = { fullName: "Omar" };
  const orderFieldsOutput = runItemCollectionPreview(input({ cart: orderFieldsCart, rawActionId: "cart_item_option:size:38" }));
  add(cases, "unrelated order-level fields remain unchanged", orderFieldsOutput.cartAfter.orderLevelFields.fullName === "Omar");

  const sources = ["item-collection-preview.types.ts", "item-collection-preview.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", "preview", file), "utf8"))
    .join("\n");
  add(cases, "preview has no Valkey or session persistence", !/from\s+["'][^"']*(?:session|valkey|redis|database|prisma|typeorm)/i.test(sources));
  add(cases, "preview has no AI Cloud Meta renderer pricing receipt DB or queue dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|whatsapp|cloud|meta|renderer|pricing|commercial|receipt|valkey|redis|database|prisma|typeorm|bull|queue)/i.test(sources));
  add(cases, "preview owns no global mutable state", !/^(?:let|var)\s+/m.test(sources));
  const controllerSource = readFileSync(join(process.cwd(), "src", "modules", "agent", "agent.controller.ts"), "utf8");
  add(cases, "controller delegates without item-collection business commands", controllerSource.includes("runItemCollectionPreview") && !/\b(?:startItemCollection|setCurrentItemCollectionOption|setCurrentItemCollectionQuantity|finalizeCurrentItemCollection|startNextItemCollection)\b/.test(controllerSource));

  const d2c = await evaluateItemOptionActions();
  const d2b = await evaluateItemCollectionPresentation();
  const d2a = await evaluateItemCollectionProgression();
  const d1 = await evaluateItemCollection();
  const planningPreview = evaluateCartPlanningPreview();
  add(cases, "D2C regression remains passing", d2c.failed === 0);
  add(cases, "D2B regression remains passing", d2b.failed === 0);
  add(cases, "D2A regression remains passing", d2a.failed === 0);
  add(cases, "D1 regression remains passing", d1.failed === 0);
  add(cases, "existing planning preview regression remains passing", planningPreview.failed === 0);

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
