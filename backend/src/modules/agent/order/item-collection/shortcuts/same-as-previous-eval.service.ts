import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import { initializeCart } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import { evaluateItemOptionActions } from "../actions/item-option-action-eval.service";
import { evaluateItemCollection } from "../item-collection-eval.service";
import { evaluateItemCollectionLoop } from "../loop/item-collection-loop-eval.service";
import { evaluateItemCollectionPreview } from "../preview/item-collection-preview-eval.service";
import { runItemCollectionPreview } from "../preview/item-collection-preview.service";
import { evaluateItemCollectionPresentation } from "../presentation/item-collection-presentation-eval.service";
import { evaluateItemCollectionProgression } from "../progression/item-collection-progression-eval.service";
import { evaluateCartPlanningPreview } from "../../planning/preview/cart-planning-preview-eval.service";
import {
  evaluateSameAsPreviousEligibility,
  handleSameAsPreviousAction,
  normalizeSameAsPreviousActionId,
} from "./same-as-previous.service";
import type { ItemCollectionPreviewInput } from "../preview/item-collection-preview.types";
import type { SameAsPreviousPreviewState } from "./same-as-previous.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type SameAsPreviousEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "same-previous-seller";
const productId = "same-previous-product";
const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Same Previous Product",
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

type PreviewFixtureInput = ItemCollectionPreviewInput & { cart: CartDraft };
type PreviewFixtureOverrides = Omit<Partial<ItemCollectionPreviewInput>, "cart"> & { cart?: CartDraft };

function input({ cart, ...overrides }: PreviewFixtureOverrides = {}): PreviewFixtureInput {
  return {
    previewEnabled: true,
    sellerId,
    productContext,
    requiredFields: fields,
    cart: cart || plannedCart(),
    ...overrides,
  };
}

function start(
  cart = plannedCart(),
  requiredFields = fields,
  previewState: SameAsPreviousPreviewState = { version: 1 },
) {
  return runItemCollectionPreview(input({ cart, requiredFields, previewState }));
}

function option(cart: CartDraft, actionId: string, requiredFields = fields, previewState?: SameAsPreviousPreviewState) {
  return runItemCollectionPreview(input({ cart, requiredFields, rawActionId: actionId, previewState }));
}

function quantity(cart: CartDraft, text: unknown, requiredFields = fields, previewState?: SameAsPreviousPreviewState) {
  return runItemCollectionPreview(input({ cart, requiredFields, itemCollectionText: text, previewState }));
}

function collectFirstItem(target = 2) {
  const started = start(plannedCart(target));
  const sized = option(started.cartAfter, "cart_item_option:size:38", fields, started.previewState);
  const colored = option(sized.cartAfter, "cart_item_option:color:black", fields, sized.previewState);
  return quantity(colored.cartAfter, "1", fields, colored.previewState);
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

/** Permanent deterministic regression suite for D3 Same as Previous shortcut. */
export async function evaluateSameAsPrevious(): Promise<SameAsPreviousEvaluationResult> {
  const cases: EvaluationCase[] = [];

  const firstStart = start();
  add(cases, "first item does not show same or different", !firstStart.shortcutPresentation && firstStart.nextStep === "SELECT_ITEM_OPTION");
  const afterFirst = collectFirstItem();
  add(cases, "second item with reusable options shows two actions", afterFirst.shortcutPresentation?.promptKey === "SAME_OR_DIFFERENT_ITEM_OPTIONS" && afterFirst.shortcutPresentation.uiHints.options?.map((option) => option.id).join(",") === "cart_item_previous:same,cart_item_previous:different");
  const same = option(afterFirst.cartAfter, "cart_item_previous:same", fields, afterFirst.previewState);
  add(cases, "same action copies all configured item options", same.success && same.cartAfter.currentItemDraft?.selectedOptions.size === "38" && same.cartAfter.currentItemDraft?.selectedOptions.color === "black");
  add(cases, "quantity is not copied", same.cartAfter.currentItemDraft?.quantity === 1 && !same.cartAfter.currentItemDraft?.quantityExplicitlySet);
  add(cases, "same action advances to collect quantity", same.progression?.step === "COLLECT_QUANTITY" && same.nextStep === "ENTER_ITEM_QUANTITY");
  const sameReplay = option(same.cartAfter, "cart_item_previous:same", fields, same.previewState);
  add(cases, "same action is idempotent", sameReplay.success && sameReplay.cartAfter.items.length === 1 && sameReplay.cartAfter.currentItemDraft?.selectedOptions.size === "38" && sameReplay.cartAfter.currentItemDraft?.selectedOptions.color === "black");

  const different = option(afterFirst.cartAfter, "cart_item_previous:different", fields, afterFirst.previewState);
  add(cases, "different action leaves draft options empty", different.success && Object.keys(different.cartAfter.currentItemDraft?.selectedOptions || {}).length === 0);
  add(cases, "different action returns normal first option presentation", different.presentation?.promptKey === "SELECT_ITEM_OPTION" && different.progression?.field?.key === "size" && !different.shortcutPresentation);
  const differentReplay = option(different.cartAfter, "cart_item_previous:different", fields, different.previewState);
  add(cases, "different action is idempotent", differentReplay.success && !differentReplay.shortcutPresentation && Object.keys(differentReplay.cartAfter.currentItemDraft?.selectedOptions || {}).length === 0);

  const reversedFields = [{ ...fields[1], askOrder: 1 }, { ...fields[0], askOrder: 2 }, ...fields.slice(2)];
  const reversedFirst = start(plannedCart(2), reversedFields);
  const reversedColor = option(reversedFirst.cartAfter, "cart_item_option:color:black", reversedFields, reversedFirst.previewState);
  const reversedSize = option(reversedColor.cartAfter, "cart_item_option:size:38", reversedFields, reversedColor.previewState);
  const reversedAfterFirst = quantity(reversedSize.cartAfter, "1", reversedFields, reversedSize.previewState);
  const reversedSame = option(reversedAfterFirst.cartAfter, "cart_item_previous:same", reversedFields, reversedAfterFirst.previewState);
  add(cases, "reversed configured option order still works", reversedSame.success && reversedSame.progression?.step === "COLLECT_QUANTITY" && reversedSame.cartAfter.currentItemDraft?.selectedOptions.color === "black" && reversedSame.cartAfter.currentItemDraft?.selectedOptions.size === "38");
  const oneOptionFields = [fields[1], ...fields.slice(2)];
  const oneFirst = start(plannedCart(2), oneOptionFields);
  const oneAfterFirst = quantity(option(oneFirst.cartAfter, "cart_item_option:color:black", oneOptionFields, oneFirst.previewState).cartAfter, "1", oneOptionFields, oneFirst.previewState);
  const oneSame = option(oneAfterFirst.cartAfter, "cart_item_previous:same", oneOptionFields, oneAfterFirst.previewState);
  add(cases, "one-option product copies only that option", oneSame.success && Object.keys(oneSame.cartAfter.currentItemDraft?.selectedOptions || {}).join(",") === "color");
  const customFields: RequiredOrderField[] = [
    { key: "material", label: "Material", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["cotton", "linen"] },
    fields[2],
  ];
  const customFirst = start(plannedCart(2), customFields);
  const customAfterFirst = quantity(option(customFirst.cartAfter, "cart_item_option:material:linen", customFields, customFirst.previewState).cartAfter, "1", customFields, customFirst.previewState);
  const customSame = option(customAfterFirst.cartAfter, "cart_item_previous:same", customFields, customAfterFirst.previewState);
  add(cases, "custom closed-list option is copied", customSame.success && customSame.cartAfter.currentItemDraft?.selectedOptions.material === "linen");
  const optionlessFields = fields.filter((field) => field.source === "customerField");
  const optionlessFirst = quantity(start(plannedCart(2), optionlessFields).cartAfter, "1", optionlessFields);
  add(cases, "option-less product does not show shortcut", !optionlessFirst.shortcutPresentation && optionlessFirst.nextStep === "ENTER_ITEM_QUANTITY");

  const invalidPreviousCart = cloneCart(afterFirst.cartAfter);
  invalidPreviousCart.items[0].selectedOptions.color = "white";
  const invalidPrevious = handleSameAsPreviousAction({ ...input({ cart: invalidPreviousCart, previewState: afterFirst.previewState }), rawActionId: "cart_item_previous:same" });
  add(cases, "previous invalid option blocks copying", !invalidPrevious.success && invalidPrevious.failureCode === "PREVIOUS_ITEM_OPTIONS_INVALID");
  const productMismatch = handleSameAsPreviousAction({ ...input({ cart: afterFirst.cartAfter, previewState: afterFirst.previewState, productContext: { ...productContext, productId: "other" } }), rawActionId: "cart_item_previous:same" });
  add(cases, "product mismatch blocks copying", !productMismatch.success && productMismatch.failureCode === "PRODUCT_MISMATCH");
  const missingPrevious = evaluateSameAsPreviousEligibility(input({ cart: firstStart.cartAfter }));
  add(cases, "missing previous item blocks shortcut", !missingPrevious.eligible && missingPrevious.failureCode === "PREVIOUS_ITEM_MISSING");
  const conflictingCart = cloneCart(afterFirst.cartAfter);
  conflictingCart.currentItemDraft!.selectedOptions.size = "40";
  const conflicting = handleSameAsPreviousAction({ ...input({ cart: conflictingCart, previewState: afterFirst.previewState }), rawActionId: "cart_item_previous:same" });
  add(cases, "current conflicting option state avoids overwrite", !conflicting.success && conflicting.failureCode === "CURRENT_DRAFT_ALREADY_CONFIGURED" && conflicting.cartAfter.currentItemDraft?.selectedOptions.size === "40");
  const atomicCart = cloneCart(afterFirst.cartAfter);
  atomicCart.items[0].selectedOptions.color = "white";
  const atomicBefore = JSON.stringify(atomicCart.currentItemDraft?.selectedOptions);
  const atomic = handleSameAsPreviousAction({ ...input({ cart: atomicCart, previewState: afterFirst.previewState }), rawActionId: "cart_item_previous:same" });
  add(cases, "copy is atomic when validation fails", !atomic.success && JSON.stringify(atomic.cartAfter.currentItemDraft?.selectedOptions) === atomicBefore);
  const missingState = handleSameAsPreviousAction({ ...input({ cart: afterFirst.cartAfter }), rawActionId: "cart_item_previous:same" });
  add(cases, "shortcut action requires explicit preview state", !missingState.success && missingState.failureCode === "PREVIEW_STATE_REQUIRED");

  for (const rawId of ["hello", "cart_item_option:size:38", "cart_offer:offer_2", "cart_quantity:2", "confirm:yes", "info:price", "size:38"]) {
    const normalized = normalizeSameAsPreviousActionId(rawId);
    add(cases, `${rawId} is not consumed`, !normalized.recognized && normalized.failureCode === "NOT_SAME_AS_PREVIOUS_ACTION");
  }
  for (const status of ["CONFIRMED", "CART_REVIEW", "COLLECTING_DELIVERY", "AWAITING_CONFIRMATION", "CANCELLED"] as const) {
    const cart = cloneCart(afterFirst.cartAfter);
    cart.status = status;
    if (status !== "COLLECTING_DELIVERY") cart.currentItemDraft = undefined;
    const output = handleSameAsPreviousAction({ ...input({ cart, previewState: afterFirst.previewState }), rawActionId: "cart_item_previous:same" });
    add(cases, `${status} state is blocked`, !output.success);
  }
  add(cases, "completed items remain unchanged by shortcut", JSON.stringify(same.cartAfter.items) === JSON.stringify(afterFirst.cartAfter.items));
  add(cases, "shortcut does not finalize or set quantity", same.cartAfter.items.length === 1 && Boolean(same.cartAfter.currentItemDraft) && !same.cartAfter.currentItemDraft?.quantityExplicitlySet);
  add(cases, "shortcut does not create next item", same.cartAfter.currentItemDraft?.id === afterFirst.cartAfter.currentItemDraft?.id);

  const afterSameFinal = quantity(same.cartAfter, "1", fields, same.previewState);
  add(cases, "existing D2D loop completes after same", afterSameFinal.success && afterSameFinal.nextStep === "CART_REVIEW_READY");
  add(cases, "identical final items may merge through D1", afterSameFinal.cartAfter.items.length === 1 && afterSameFinal.cartAfter.items[0].quantity === 2);
  const thirdTarget = collectFirstItem(3);
  const thirdSame = option(thirdTarget.cartAfter, "cart_item_previous:same", fields, thirdTarget.previewState);
  const thirdStarted = quantity(thirdSame.cartAfter, "1", fields, thirdSame.previewState);
  const staleReplay = option(thirdStarted.cartAfter, "cart_item_previous:same", fields, thirdSame.previewState);
  add(cases, "stale shortcut replay does not restart the next item", !staleReplay.success && staleReplay.failureCode === "STALE_PREVIEW_STATE" && Object.keys(staleReplay.cartAfter.currentItemDraft?.selectedOptions || {}).length === 0);
  const changedSecond = quantity(option(option(different.cartAfter, "cart_item_option:size:40", fields, different.previewState).cartAfter, "cart_item_option:color:pink", fields, different.previewState).cartAfter, "1", fields, different.previewState);
  add(cases, "different final items remain separate", changedSecond.success && changedSecond.cartAfter.items.length === 2);
  const stateBefore = JSON.stringify(afterFirst.previewState);
  const stateDetached = option(afterFirst.cartAfter, "cart_item_previous:different", fields, afterFirst.previewState);
  add(cases, "preview state is detached and not persisted", JSON.stringify(afterFirst.previewState) === stateBefore && stateDetached.previewState !== afterFirst.previewState);

  const sources = ["same-as-previous.types.ts", "same-as-previous.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "item-collection", "shortcuts", file), "utf8"))
    .join("\n");
  add(cases, "shortcut has no AI Cloud Meta pricing receipt DB or queue dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|whatsapp|cloud|meta|pricing|commercial|receipt|valkey|redis|database|prisma|typeorm|bull|queue)/i.test(sources));
  add(cases, "shortcut owns no global mutable state", !/^(?:let|var)\s+/m.test(sources));

  const d2d = await evaluateItemCollectionLoop();
  const d2c = await evaluateItemOptionActions();
  const d2b = await evaluateItemCollectionPresentation();
  const d2a = await evaluateItemCollectionProgression();
  const d1 = await evaluateItemCollection();
  const planningPreview = evaluateCartPlanningPreview();
  add(cases, "D2D regression remains passing", d2d.failed === 0);
  add(cases, "D2C regression remains passing", d2c.failed === 0);
  add(cases, "D2B regression remains passing", d2b.failed === 0);
  add(cases, "D2A regression remains passing", d2a.failed === 0);
  add(cases, "D1 regression remains passing", d1.failed === 0);
  add(cases, "planning preview regression remains passing", planningPreview.failed === 0);

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
