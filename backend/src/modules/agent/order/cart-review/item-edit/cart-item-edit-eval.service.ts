import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../../config/offers/offer-config.service";
import type { ProductContext } from "../../../config/product-context.types";
import type { RequiredOrderField } from "../../../config/required-fields.types";
import { createCartItem, initializeCart } from "../../cart-state.service";
import type { CartDraft, CartItem } from "../../cart-state.types";
import { evaluateCartCommercialIntegration } from "../../commercial/cart-commercial-evaluation-eval.service";
import { evaluateItemOptionActions } from "../../item-collection/actions/item-option-action-eval.service";
import { evaluateItemCollectionPresentation } from "../../item-collection/presentation/item-collection-presentation-eval.service";
import { evaluateItemCollectionProgression } from "../../item-collection/progression/item-collection-progression-eval.service";
import { evaluateItemCollection } from "../../item-collection/item-collection-eval.service";
import { evaluateCartPlanning } from "../../planning/cart-planning-eval.service";
import { evaluateCartPricing } from "../../pricing/cart-pricing-eval.service";
import { evaluateCartReview } from "../cart-review-eval.service";
import { runCartReviewPreview } from "../cart-review-preview.service";
import type { CartReviewPreviewInput } from "../cart-review.types";
import type { CartItemEditPreviewState } from "./cart-item-edit.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type CartItemEditEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const NOW = new Date("2026-07-19T12:00:00.000Z");
const sellerId = "cart-item-edit-seller";
const productId = "cart-item-edit-product";

const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Cart Item Edit Product",
  price: 199,
  currency: "MAD",
  active: true,
  images: [],
  benefits: [],
  optionGroups: [],
  infoMenu: [],
  stock: { enabled: false, status: "AVAILABLE" },
  offers: [
    {
      id: "edit-offer-two",
      productId,
      label: "Two matching items",
      requiredItemCount: 2,
      totalPrice: 350,
      currency: "MAD",
      active: true,
      allowMixedOptions: false,
      priority: 1,
    },
  ],
};

const fields: RequiredOrderField[] = [
  { key: "size", label: "Taille", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["39", "41"] },
  { key: "color", label: "Couleur", required: true, enabled: true, source: "productOption", askOrder: 2, options: ["black", "red"] },
  { key: "quantity", label: "Quantité", required: true, enabled: true, source: "customerField", askOrder: 3, semanticType: "QUANTITY" },
  { key: "fullName", label: "Nom", required: true, enabled: true, source: "customerField", askOrder: 4, semanticType: "PERSON_NAME" },
];

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

function cloneCart(cart: CartDraft): CartDraft {
  return {
    ...cart,
    items: cart.items.map((entry) => ({ ...entry, selectedOptions: { ...entry.selectedOptions } })),
    currentItemDraft: cart.currentItemDraft
      ? { ...cart.currentItemDraft, selectedOptions: { ...cart.currentItemDraft.selectedOptions } }
      : undefined,
    orderLevelFields: { ...cart.orderLevelFields },
  };
}

function item(input: Partial<CartItem> = {}): CartItem {
  return createCartItem({
    id: "edit-item-one",
    productId,
    quantity: 1,
    selectedOptions: { size: "39", color: "black" },
    status: "COMPLETE",
    ...input,
  });
}

function reviewedCart(input: Partial<CartDraft> = {}): CartDraft {
  const items = input.items || [
    item({ id: "edit-item-one", quantity: 2, selectedOptions: { size: "39", color: "black" } }),
    item({ id: "edit-item-two", quantity: 1, selectedOptions: { size: "41", color: "red" } }),
  ];
  return {
    ...initializeCart(),
    mode: "STANDARD",
    status: "CART_REVIEW",
    targetItemCount: items.reduce((total, entry) => total + entry.quantity, 0),
    items,
    orderLevelFields: { fullName: "Omar" },
    ...input,
  };
}

function previewInput(overrides: Partial<CartReviewPreviewInput> & { cart: CartDraft }): CartReviewPreviewInput {
  const offerLookup = new OfferConfigService().getConfiguredOffers({
    sellerId,
    productId,
    productContexts: [productContext],
  });
  return {
    previewEnabled: true,
    sellerId,
    productContext,
    requiredFields: fields,
    offerLookup,
    now: NOW,
    ...overrides,
  };
}

function run(input: {
  cart: CartDraft;
  rawActionId?: unknown;
  editState?: CartItemEditPreviewState;
  cartReviewText?: unknown;
  requiredFields?: RequiredOrderField[];
}) {
  return runCartReviewPreview(previewInput({
    cart: input.cart,
    rawActionId: input.rawActionId,
    ...(input.editState ? { cartItemEditPreviewState: input.editState } : {}),
    ...(input.cartReviewText !== undefined ? { cartReviewText: input.cartReviewText } : {}),
    ...(input.requiredFields ? { requiredFields: input.requiredFields } : {}),
  }));
}

function start(cart: CartDraft, itemId = "edit-item-one", requiredFields?: RequiredOrderField[]) {
  return run({ cart, rawActionId: `cart_review_item:options:${itemId}`, ...(requiredFields ? { requiredFields } : {}) });
}

function editStateOf(value: ReturnType<typeof run>): CartItemEditPreviewState {
  if (!value.cartItemEditPreviewState) throw new Error("Expected item edit preview state");
  return value.cartItemEditPreviewState;
}

/** Permanent vertical-slice regression suite for Phase 6.3E2 detached cart item editing. */
export async function evaluateCartItemEdit(): Promise<CartItemEditEvaluationResult> {
  const cases: EvaluationCase[] = [];
  const initial = reviewedCart();
  const initialBefore = JSON.stringify(initial);
  const entered = start(initial);
  const state = editStateOf(entered);

  add(cases, "valid stable item enters option edit mode", entered.success && entered.cartItemEditPreview?.nextStep === "SELECT_ITEM_OPTION" && state.sourceItemId === "edit-item-one");
  add(cases, "array index cannot identify an item", !start(initial, "0").success && start(initial, "0").failureCode === "UNSAFE_CART_ITEM_ID");
  add(cases, "unknown item ID is rejected", !start(initial, "missing-item").success && start(initial, "missing-item").failureCode === "UNKNOWN_CART_ITEM");
  add(cases, "original completed cart remains unchanged during edit", JSON.stringify(initial) === initialBefore && entered.cartAfter.items[0].selectedOptions.size === "39");
  add(cases, "existing options initialize detached working item", state.workingItem.selectedOptions.size === "39" && state.workingItem.selectedOptions.color === "black" && state.workingItem.quantity === 2);
  add(cases, "item edit UI uses canonical option IDs", entered.presentation?.uiHints?.options?.some((option) => option.id === "cart_item_option:size:41") === true);
  add(cases, "item edit UI includes save and cancel", entered.presentation?.uiHints?.options?.some((option) => option.id === "cart_review_item_edit:save") === true && entered.presentation?.uiHints?.options?.some((option) => option.id === "cart_review_item_edit:cancel") === true);
  const repeatedStart = run({ cart: entered.cartAfter, rawActionId: "cart_review_item:options:edit-item-one", editState: state });
  add(cases, "starting the same edit twice is safe", repeatedStart.success && !repeatedStart.changed && editStateOf(repeatedStart).sourceItemId === "edit-item-one");
  const invalidSourceCart = reviewedCart({ items: [item({ id: "invalid-source", selectedOptions: { size: "40", color: "black" } })], targetItemCount: 1 });
  const invalidSource = start(invalidSourceCart, "invalid-source");
  add(cases, "invalid source options cannot enter edit mode", !invalidSource.success && invalidSource.cartItemEditPreview?.failureCode === "INVALID_SOURCE_ITEM_OPTIONS");

  const sizeChanged = run({ cart: entered.cartAfter, rawActionId: "cart_item_option:size:41", editState: state });
  const sizeState = editStateOf(sizeChanged);
  add(cases, "changing size updates only working state", sizeChanged.success && sizeChanged.changed && sizeState.workingItem.selectedOptions.size === "41" && sizeChanged.cartAfter.items[0].selectedOptions.size === "39");
  const colorChanged = run({ cart: sizeChanged.cartAfter, rawActionId: "cart_item_option:color:red", editState: sizeState });
  const colorState = editStateOf(colorChanged);
  add(cases, "changing color updates only working state", colorChanged.success && colorChanged.changed && colorState.workingItem.selectedOptions.color === "red" && colorChanged.cartAfter.items[0].selectedOptions.color === "black");
  add(cases, "current canonical value is idempotent", !run({ cart: colorChanged.cartAfter, rawActionId: "cart_item_option:color:red", editState: colorState }).changed);
  add(cases, "closed list rejects noncanonical value", !run({ cart: colorChanged.cartAfter, rawActionId: "cart_item_option:size:40", editState: colorState }).success);
  add(cases, "display label is never authority", !run({ cart: colorChanged.cartAfter, rawActionId: "cart_item_option:color:Rouge", editState: colorState }).success);
  add(cases, "raw text outside awaiting state is not consumed", !run({ cart: colorChanged.cartAfter, cartReviewText: "anything", editState: colorState }).handled);

  const savedUnique = run({ cart: sizeChanged.cartAfter, rawActionId: "cart_review_item_edit:save", editState: sizeState });
  add(cases, "save preserves source quantity", savedUnique.success && savedUnique.cartAfter.items.find((entry) => entry.id === "edit-item-one")?.quantity === 2);
  add(cases, "save changes only selected source item", savedUnique.cartAfter.items.find((entry) => entry.id === "edit-item-one")?.selectedOptions.color === "black" && savedUnique.cartAfter.items.find((entry) => entry.id === "edit-item-two")?.selectedOptions.color === "red");
  add(cases, "save preserves order-level fields", savedUnique.cartAfter.orderLevelFields.fullName === "Omar");
  add(cases, "unique options remain separate", savedUnique.cartAfter.items.length === 2 && savedUnique.cartAfter.items.some((entry) => entry.id === "edit-item-one"));
  add(cases, "stable source ID remains when no merge occurs", savedUnique.cartAfter.items.some((entry) => entry.id === "edit-item-one"));
  add(cases, "save synchronizes target completed units", savedUnique.cartAfter.targetItemCount === 3 && savedUnique.cartItemEditPreview?.review?.completedUnits === 3);
  add(cases, "commercial evaluation refreshes after save", Boolean(savedUnique.commercialEvaluation?.standardPricing));
  add(cases, "recommendation is not auto-selected", !savedUnique.cartAfter.selectedOfferId);
  add(cases, "save returns to cart review presentation", savedUnique.success && savedUnique.cartItemEditPreview?.nextStep === "RETURN_TO_CART_REVIEW" && savedUnique.presentation?.promptKey === "CART_REVIEW");
  const missingRequiredState: CartItemEditPreviewState = {
    ...state,
    workingItem: { ...state.workingItem, selectedOptions: { size: "39" } },
  };
  const missingRequired = run({ cart: entered.cartAfter, rawActionId: "cart_review_item_edit:save", editState: missingRequiredState });
  add(cases, "save requires every required item option", !missingRequired.success && missingRequired.cartItemEditPreview?.failureCode === "MISSING_REQUIRED_ITEM_FIELDS");

  const unchanged = start(initial);
  const unchangedSave = run({ cart: unchanged.cartAfter, rawActionId: "cart_review_item_edit:save", editState: editStateOf(unchanged) });
  add(cases, "no-change save is idempotent", unchangedSave.success && !unchangedSave.changed && JSON.stringify(unchangedSave.cartAfter) === JSON.stringify(initial));
  const cancel = run({ cart: entered.cartAfter, rawActionId: "cart_review_item_edit:cancel", editState: state });
  add(cases, "cancel leaves cart unchanged", cancel.success && !cancel.changed && JSON.stringify(cancel.cartAfter) === JSON.stringify(initial));
  const cancelReplay = run({ cart: cancel.cartAfter, rawActionId: "cart_review_item_edit:cancel" });
  add(cases, "cancel twice is safe", cancelReplay.success && !cancelReplay.changed);

  const staleRemovedCart = reviewedCart({ items: [item({ id: "edit-item-two", quantity: 1, selectedOptions: { size: "41", color: "red" } })], targetItemCount: 1 });
  const staleRemoved = run({ cart: staleRemovedCart, rawActionId: "cart_review_item_edit:save", editState: state });
  add(cases, "stale source removal blocks save", !staleRemoved.success && staleRemoved.cartItemEditPreview?.failureCode === "STALE_ITEM_EDIT_STATE");
  const staleQuantityCart = cloneCart(initial);
  staleQuantityCart.items[0].quantity = 3;
  staleQuantityCart.targetItemCount = 4;
  const staleQuantity = run({ cart: staleQuantityCart, rawActionId: "cart_review_item_edit:save", editState: state });
  add(cases, "stale quantity change blocks save", !staleQuantity.success && staleQuantity.cartItemEditPreview?.failureCode === "STALE_ITEM_EDIT_STATE");
  const staleOptionCart = cloneCart(initial);
  staleOptionCart.items[0].selectedOptions.color = "red";
  const staleOption = run({ cart: staleOptionCart, rawActionId: "cart_review_item_edit:save", editState: state });
  add(cases, "stale option change blocks save", !staleOption.success && staleOption.cartItemEditPreview?.failureCode === "STALE_ITEM_EDIT_STATE");
  const staleLifecycleCart = cloneCart(initial);
  staleLifecycleCart.status = "COLLECTING_DELIVERY";
  const staleLifecycle = run({ cart: staleLifecycleCart, rawActionId: "cart_review_item_edit:save", editState: state });
  add(cases, "lifecycle change blocks save", !staleLifecycle.success && staleLifecycle.cartItemEditPreview?.failureCode === "STALE_ITEM_EDIT_STATE");

  const mergeCart = reviewedCart({
    items: [
      item({ id: "merge-source", quantity: 2, selectedOptions: { size: "39", color: "black" } }),
      item({ id: "merge-destination", quantity: 1, selectedOptions: { size: "41", color: "red" } }),
    ],
    targetItemCount: 3,
  });
  const mergeStart = start(mergeCart, "merge-source");
  const mergeSize = run({ cart: mergeStart.cartAfter, rawActionId: "cart_item_option:size:41", editState: editStateOf(mergeStart) });
  const mergeColor = run({ cart: mergeSize.cartAfter, rawActionId: "cart_item_option:color:red", editState: editStateOf(mergeSize) });
  const merged = run({ cart: mergeColor.cartAfter, rawActionId: "cart_review_item_edit:save", editState: editStateOf(mergeColor) });
  add(cases, "matching options merge safely through cart boundary", merged.success && merged.cartAfter.items.length === 1 && merged.cartItemEditPreview?.mergedIntoItemId === "merge-destination");
  add(cases, "merge preserves destination stable ID and total units", merged.cartAfter.items[0]?.id === "merge-destination" && merged.cartAfter.items[0]?.quantity === 3 && merged.cartAfter.targetItemCount === 3);
  add(cases, "merge does not duplicate items", merged.cartAfter.items.length === 1 && merged.cartAfter.items[0].quantity === 3);
  const staleMergeReplay = run({ cart: merged.cartAfter, rawActionId: "cart_review_item_edit:save", editState: editStateOf(mergeColor) });
  add(cases, "stale replay after merge is rejected", !staleMergeReplay.success && staleMergeReplay.cartItemEditPreview?.failureCode === "STALE_ITEM_EDIT_STATE");

  const reversedFields = [fields[1], fields[0], fields[2], fields[3]];
  const reversed = start(initial, "edit-item-one", reversedFields);
  const reversedChange = run({ cart: reversed.cartAfter, rawActionId: "cart_item_option:color:red", editState: editStateOf(reversed), requiredFields: reversedFields });
  add(cases, "reversed configured field order works", reversedChange.success && editStateOf(reversedChange).workingItem.selectedOptions.color === "red");
  const oneOptionFields = [
    { ...fields[0], options: ["39"] },
    fields[2],
    fields[3],
  ];
  const oneOptionCart = reviewedCart({ items: [item({ id: "one-option", selectedOptions: { size: "39" } })], targetItemCount: 1 });
  const oneOption = start(oneOptionCart, "one-option", oneOptionFields);
  add(cases, "one-option product enters edit safely", oneOption.success && oneOption.presentation?.uiHints?.options?.some((option) => option.id === "cart_item_option:size:39") === true);
  const customFields = [
    { key: "material", label: "Material", required: true, enabled: true, source: "productOption" as const, askOrder: 1, options: ["cotton", "linen"] },
    fields[2],
    fields[3],
  ];
  const customCart = reviewedCart({ items: [item({ id: "custom-option", selectedOptions: { material: "cotton" } })], targetItemCount: 1 });
  const customStart = start(customCart, "custom-option", customFields);
  const customChange = run({ cart: customStart.cartAfter, rawActionId: "cart_item_option:material:linen", editState: editStateOf(customStart), requiredFields: customFields });
  add(cases, "custom closed-list option works", customChange.success && editStateOf(customChange).workingItem.selectedOptions.material === "linen");

  const openFields: RequiredOrderField[] = [
    { key: "engraving", label: "Engraving", required: true, enabled: true, source: "productOption", askOrder: 1 },
    fields[2],
    fields[3],
  ];
  const openCart = reviewedCart({ items: [item({ id: "open-text", selectedOptions: { engraving: "A" } })], targetItemCount: 1 });
  const openStart = start(openCart, "open-text", openFields);
  add(cases, "open-text option exposes explicit text action", openStart.presentation?.uiHints?.options?.some((option) => option.id === "cart_review_item_edit:text:engraving") === true);
  const textAwaiting = run({ cart: openStart.cartAfter, rawActionId: "cart_review_item_edit:text:engraving", editState: editStateOf(openStart), requiredFields: openFields });
  add(cases, "open-text option creates explicit awaiting state", textAwaiting.success && editStateOf(textAwaiting).awaitingTextFieldKey === "engraving");
  const openText = run({ cart: textAwaiting.cartAfter, editState: editStateOf(textAwaiting), cartReviewText: "  500   ml  ", requiredFields: openFields });
  add(cases, "open-text capture normalizes only while awaited", openText.success && editStateOf(openText).workingItem.selectedOptions.engraving === "500 ml");
  for (const [name, text] of [["empty", "   "], ["control", "bad\u0001"], ["oversized", "x".repeat(161)]] as const) {
    const rejected = run({ cart: textAwaiting.cartAfter, editState: editStateOf(textAwaiting), cartReviewText: text, requiredFields: openFields });
    add(cases, `${name} open text is rejected`, !rejected.success && rejected.cartItemEditPreview?.failureCode === "INVALID_ITEM_OPTION_TEXT");
  }
  const orderScopedText = run({ cart: openStart.cartAfter, rawActionId: "cart_review_item_edit:text:fullName", editState: editStateOf(openStart), requiredFields: openFields });
  add(cases, "order-scoped fields cannot be edited as item options", !orderScopedText.success && orderScopedText.cartItemEditPreview?.failureCode === "INVALID_ITEM_OPTION");

  const selectedOfferCart = reviewedCart({
    mode: "OFFER",
    selectedOfferId: "edit-offer-two",
    items: [item({ id: "offer-source", quantity: 2, selectedOptions: { size: "39", color: "black" } })],
    targetItemCount: 2,
  });
  const offerStart = start(selectedOfferCart, "offer-source");
  const offerChanged = run({ cart: offerStart.cartAfter, rawActionId: "cart_item_option:color:red", editState: editStateOf(offerStart) });
  const offerSaved = run({ cart: offerChanged.cartAfter, rawActionId: "cart_review_item_edit:save", editState: editStateOf(offerChanged) });
  add(cases, "selected eligible offer remains selected before change", offerStart.commercialEvaluation?.state === "SELECTED_OFFER_ELIGIBLE");
  add(cases, "selected eligible offer remains selected after option replacement", offerSaved.success && offerSaved.commercialEvaluation?.state === "SELECTED_OFFER_ELIGIBLE" && offerSaved.cartAfter.selectedOfferId === "edit-offer-two");

  const sourceRoot = join(process.cwd(), "src", "modules", "agent", "order", "cart-review", "item-edit");
  const sourceFiles = [
    "cart-item-edit.types.ts",
    "cart-item-edit.service.ts",
    "cart-item-edit-preview.service.ts",
    "item-option-text-normalizer.service.ts",
  ].map((file) => readFileSync(join(sourceRoot, file), "utf8")).join("\n");
  add(cases, "input cart and edit state are not mutated", JSON.stringify(initial) === initialBefore && state.workingItem.selectedOptions.size === "39");
  add(cases, "returned state is detached", state !== entered.cartItemEditPreview?.editState && !Object.is(state.workingItem.selectedOptions, entered.cartItemEditPreview?.editState?.workingItem.selectedOptions));
  add(cases, "no quantity editing occurs in item edit module", !/quantity\s*=/.test(readFileSync(join(sourceRoot, "cart-item-edit.service.ts"), "utf8").replace(/quantity ===/g, "")));
  add(cases, "no Valkey session persistence exists", !/from\s+["'][^"']*(?:session|valkey|redis|database|prisma|typeorm)/i.test(sourceFiles));
  add(cases, "no AI Cloud Meta DB queue dependency exists", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|whatsapp|cloud|meta|receipt|valkey|redis|database|prisma|typeorm|bull|queue)/i.test(sourceFiles));

  const e = await evaluateCartReview();
  const d2c = await evaluateItemOptionActions();
  const d2b = await evaluateItemCollectionPresentation();
  const d2a = await evaluateItemCollectionProgression();
  const d1 = await evaluateItemCollection();
  const b3 = evaluateCartCommercialIntegration();
  const b2 = evaluateCartPricing();
  add(cases, "Phase 6.3E cart review regression remains passing", e.failed === 0);
  add(cases, "D2C option action regression remains passing", d2c.failed === 0);
  add(cases, "D2B option presentation regression remains passing", d2b.failed === 0);
  add(cases, "D2A progression regression remains passing", d2a.failed === 0);
  add(cases, "D1 collection regression remains passing", d1.failed === 0);
  add(cases, "B3 commercial regression remains passing", b3.summary.failed === 0);
  add(cases, "B2 pricing regression remains passing", b2.summary.failed === 0);

  const passed = cases.filter((entry) => entry.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
