import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import { initializeCart } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import { evaluateItemCollection } from "../item-collection-eval.service";
import { startItemCollection } from "../item-collection.service";
import { evaluateItemCollectionPresentation } from "../presentation/item-collection-presentation-eval.service";
import { buildItemCollectionOptionActionId } from "../presentation/item-collection-presentation.service";
import { evaluateItemCollectionProgression } from "../progression/item-collection-progression-eval.service";
import { analyzeItemCollectionProgression } from "../progression/item-collection-progression.service";
import { handleItemOptionAction } from "./item-option-action-handler.service";
import { normalizeItemOptionActionId } from "./item-option-action-normalizer.service";
import type { ItemOptionActionHandlerInput } from "./item-option-action.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type ItemOptionActionEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "item-option-action-seller";
const productId = "item-option-action-product";
const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Item Option Action Product",
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

function start(cart = plannedCart()): CartDraft {
  return startItemCollection({ cart, sellerId, productContext, requiredFields: fields }).cart;
}

function input(
  actionId: string,
  cart = start(),
  overrides: Partial<Omit<ItemOptionActionHandlerInput, "action" | "cart">> = {},
): ItemOptionActionHandlerInput {
  const normalization = normalizeItemOptionActionId(actionId);
  if (!normalization.action) throw new Error(`Expected valid action fixture: ${actionId}`);
  return {
    action: normalization.action,
    cart,
    sellerId,
    productContext,
    requiredFields: fields,
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

/** Permanent deterministic regression suite for D2C item-option action handling. */
export async function evaluateItemOptionActions(): Promise<ItemOptionActionEvaluationResult> {
  const cases: EvaluationCase[] = [];

  const size = normalizeItemOptionActionId("cart_item_option:size:38");
  const color = normalizeItemOptionActionId("cart_item_option:color:black");
  add(cases, "valid size action normalizes", size.recognized && size.valid && size.action?.fieldKey === "size");
  add(cases, "valid color action normalizes", color.recognized && color.valid && color.action?.fieldKey === "color");
  add(cases, "canonical value is preserved", size.action?.canonicalValue === "38" && color.action?.canonicalValue === "black");
  for (const rawId of ["hello", "38", "confirm:yes", "confirm:edit", "order:confirm", "info:price", "first_entry:order_now", "cart_offer:offer-2", "cart_quantity:2", "size:38", "color:black", "custom:value"]) {
    const normalized = normalizeItemOptionActionId(rawId);
    add(cases, `${rawId} is not consumed`, !normalized.recognized && normalized.failureCode === "NOT_ITEM_OPTION_ACTION");
  }
  add(cases, "empty field key is rejected", normalizeItemOptionActionId("cart_item_option::38").failureCode === "EMPTY_FIELD_KEY");
  add(cases, "empty canonical value is rejected", normalizeItemOptionActionId("cart_item_option:size:").failureCode === "EMPTY_CANONICAL_VALUE");
  add(cases, "extra action segment is rejected", normalizeItemOptionActionId("cart_item_option:size:38:extra").failureCode === "EXTRA_ACTION_SEGMENT");
  add(cases, "unsafe whitespace is rejected", normalizeItemOptionActionId("cart_item_option:size: 38").failureCode === "UNSAFE_CANONICAL_VALUE");
  add(cases, "percent-encoded values are rejected without decoding", normalizeItemOptionActionId("cart_item_option:size:%2038").failureCode === "UNSAFE_CANONICAL_VALUE");
  add(cases, "unsafe control characters are rejected", normalizeItemOptionActionId(`cart_item_option:size:38\u0001`).failureCode === "UNSAFE_CANONICAL_VALUE");
  add(cases, "excessive action length is rejected", normalizeItemOptionActionId(`cart_item_option:size:${"x".repeat(180)}`).failureCode === "ACTION_ID_TOO_LONG");

  const initial = start();
  const initialBefore = JSON.stringify(initial);
  const sizeHandled = handleItemOptionAction(input("cart_item_option:size:38", initial));
  add(cases, "expected size plus size action succeeds", sizeHandled.success && sizeHandled.changed && sizeHandled.collectionResult?.cart.currentItemDraft?.selectedOptions.size === "38");
  add(cases, "valid canonical value delegates through D1", Boolean(sizeHandled.collectionResult) && sizeHandled.collectionResult?.success === true);
  add(cases, "D2A progression advances to the next configured option", sizeHandled.progression?.step === "COLLECT_OPTION" && sizeHandled.progression.field?.key === "color");
  add(cases, "only current item draft is updated", sizeHandled.collectionResult?.cart.items.length === 0 && sizeHandled.collectionResult?.cart.currentItemDraft?.selectedOptions.size === "38");
  add(cases, "input cart remains unchanged outside D1 result", JSON.stringify(initial) === initialBefore);
  add(cases, "expected size plus color action is rejected", !handleItemOptionAction(input("cart_item_option:color:black", initial)).success && handleItemOptionAction(input("cart_item_option:color:black", initial)).failureCode === "FIELD_NOT_CURRENTLY_EXPECTED");
  add(cases, "expected color plus size action is rejected", !handleItemOptionAction(input("cart_item_option:size:38", sizeHandled.collectionResult!.cart)).success && handleItemOptionAction(input("cart_item_option:size:38", sizeHandled.collectionResult!.cart)).failureCode === "FIELD_NOT_CURRENTLY_EXPECTED");
  add(cases, "unknown configured value is rejected", handleItemOptionAction(input("cart_item_option:size:42", initial)).failureCode === "CANONICAL_VALUE_NOT_CONFIGURED");
  add(cases, "display label is not accepted as canonical authority", handleItemOptionAction(input("cart_item_option:size:Large", initial)).failureCode === "CANONICAL_VALUE_NOT_CONFIGURED");
  const repeated = handleItemOptionAction(input("cart_item_option:size:38", sizeHandled.collectionResult!.cart));
  add(cases, "same action twice is idempotent", !repeated.changed && !repeated.success && repeated.failureCode === "FIELD_NOT_CURRENTLY_EXPECTED");

  const completedCart = cloneCart(sizeHandled.collectionResult!.cart);
  completedCart.items = [{ ...completedCart.currentItemDraft!, id: "completed-item", status: "COMPLETE", quantity: 1, quantityExplicitlySet: true }];
  completedCart.currentItemDraft = { ...completedCart.currentItemDraft!, id: "current-item", selectedOptions: { size: "38" } };
  completedCart.targetItemCount = 2;
  completedCart.orderLevelFields = { fullName: "Omar" };
  const completedBefore = JSON.stringify(completedCart.items);
  const orderBefore = JSON.stringify(completedCart.orderLevelFields);
  const colorHandled = handleItemOptionAction(input("cart_item_option:color:black", completedCart));
  add(cases, "completed items remain unchanged", JSON.stringify(colorHandled.collectionResult?.cart.items) === completedBefore);
  add(cases, "order-level fields remain unchanged", JSON.stringify(colorHandled.collectionResult?.cart.orderLevelFields) === orderBefore);
  add(cases, "last option advances to COLLECT_QUANTITY", colorHandled.success && colorHandled.progression?.step === "COLLECT_QUANTITY");
  add(cases, "no quantity mutation occurs", colorHandled.collectionResult?.cart.currentItemDraft?.quantity === 1 && !colorHandled.collectionResult?.cart.currentItemDraft?.quantityExplicitlySet);
  add(cases, "no item finalization occurs", colorHandled.collectionResult?.cart.items.length === 1 && Boolean(colorHandled.collectionResult?.cart.currentItemDraft));
  add(cases, "no new current draft is created", colorHandled.collectionResult?.cart.currentItemDraft?.id === "current-item");

  const quantityCart = cloneCart(colorHandled.collectionResult!.cart);
  const quantityAction = handleItemOptionAction(input("cart_item_option:size:40", quantityCart));
  add(cases, "action during COLLECT_QUANTITY is rejected", !quantityAction.success && quantityAction.failureCode === "PROGRESSION_NOT_COLLECTING_OPTION");
  const readyCart = cloneCart(quantityCart);
  readyCart.currentItemDraft!.quantity = 1;
  readyCart.currentItemDraft!.quantityExplicitlySet = true;
  const readyAction = handleItemOptionAction(input("cart_item_option:size:40", readyCart));
  add(cases, "action during READY_TO_FINALIZE is rejected", !readyAction.success && readyAction.failureCode === "PROGRESSION_NOT_COLLECTING_OPTION");
  const noDraftAction = handleItemOptionAction(input("cart_item_option:size:38", plannedCart()));
  add(cases, "action without current item draft is rejected", !noDraftAction.success && noDraftAction.failureCode === "CURRENT_ITEM_MISSING");

  const openTextFields: RequiredOrderField[] = [
    { key: "engraving", label: "Engraving", required: true, enabled: true, source: "productOption", askOrder: 1 },
    fields[2],
  ];
  const openTextCart = startItemCollection({ cart: plannedCart(1), sellerId, productContext, requiredFields: openTextFields }).cart;
  const openTextAction = handleItemOptionAction(input("cart_item_option:engraving:hello", openTextCart, { requiredFields: openTextFields }));
  add(cases, "open-text option action is deferred for later text capture", !openTextAction.success && openTextAction.failureCode === "OPEN_TEXT_ACTION_NOT_SUPPORTED");
  const mismatchAction = handleItemOptionAction(input("cart_item_option:size:38", initial, { productContext: { ...productContext, productId: "other-product" } }));
  add(cases, "product mismatch is rejected", !mismatchAction.success && mismatchAction.failureCode === "PRODUCT_MISMATCH");
  for (const status of ["CONFIRMED", "CANCELLED", "CART_REVIEW", "COLLECTING_DELIVERY", "AWAITING_CONFIRMATION"] as const) {
    const cart = cloneCart(initial);
    cart.status = status;
    if (["CART_REVIEW", "AWAITING_CONFIRMATION", "CONFIRMED"].includes(status)) {
      cart.currentItemDraft = undefined;
    }
    const output = handleItemOptionAction(input("cart_item_option:size:38", cart));
    add(cases, `${status} state is blocked`, !output.success && !output.changed);
  }

  const configBefore = JSON.stringify(fields);
  const cartBefore = JSON.stringify(initial);
  handleItemOptionAction(input("cart_item_option:size:38", initial));
  add(cases, "handler does not mutate config", JSON.stringify(fields) === configBefore);
  add(cases, "handler does not mutate cart outside D1", JSON.stringify(initial) === cartBefore);
  add(cases, "D2B action IDs remain compatible", buildItemCollectionOptionActionId("size", "38") === "cart_item_option:size:38" && normalizeItemOptionActionId("cart_item_option:size:38").valid);

  const sources = [
    "item-option-action.types.ts",
    "item-option-action-normalizer.service.ts",
    "item-option-action-handler.service.ts",
  ].map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", "actions", file), "utf8")).join("\n");
  add(cases, "action module has no AI, WhatsApp, Preview, renderer, pricing, receipt, Valkey, DB, or queue dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|whatsapp|cloud|preview|renderer|pricing|commercial|receipt|valkey|redis|database|prisma|typeorm|bull|queue)/i.test(sources));
  add(cases, "action module owns no global mutable state", !/^(?:let|var)\s+/m.test(sources));

  const d2b = await evaluateItemCollectionPresentation();
  const d2a = await evaluateItemCollectionProgression();
  const d1 = await evaluateItemCollection();
  add(cases, "D2B regression remains passing", d2b.failed === 0);
  add(cases, "D2A regression remains passing", d2a.failed === 0);
  add(cases, "D1 regression remains passing", d1.failed === 0);

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
