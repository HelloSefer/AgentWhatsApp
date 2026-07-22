import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import { createCartItem, initializeCart } from "../cart-state.service";
import type { CartDraft, CartItem } from "../cart-state.types";
import { evaluateCartCommercialIntegration } from "../commercial/cart-commercial-evaluation-eval.service";
import { evaluateItemCollectionLoop } from "../item-collection/loop/item-collection-loop-eval.service";
import { evaluateSameAsPrevious } from "../item-collection/shortcuts/same-as-previous-eval.service";
import { evaluateCartPlanning } from "../planning/cart-planning-eval.service";
import { evaluateCartPlanningPreview } from "../planning/preview/cart-planning-preview-eval.service";
import { evaluateCartPricing } from "../pricing/cart-pricing-eval.service";
import { normalizeCartReviewAction } from "./cart-review-action.service";
import { runCartReviewPreview } from "./cart-review-preview.service";
import type {
  CartReviewPreviewInput,
  CartReviewPreviewState,
} from "./cart-review.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type CartReviewEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const NOW = new Date("2026-07-18T12:00:00.000Z");
const sellerId = "cart-review-seller";
const productId = "cart-review-product";

const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Cart Review Product",
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
      id: "review-offer-two",
      productId,
      label: "Two review items",
      requiredItemCount: 2,
      totalPrice: 350,
      currency: "MAD",
      active: true,
      allowMixedOptions: false,
      priority: 2,
    },
    {
      id: "review-offer-three",
      productId,
      label: "Three review items",
      requiredItemCount: 3,
      totalPrice: 499,
      currency: "MAD",
      active: true,
      allowMixedOptions: true,
      priority: 1,
    },
  ],
};

const fields: RequiredOrderField[] = [
  { key: "size", label: "Taille", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["38", "40"] },
  { key: "color", label: "Couleur", required: true, enabled: true, source: "productOption", askOrder: 2, options: ["black", "pink"] },
  { key: "quantity", label: "Quantité", required: true, enabled: true, source: "customerField", askOrder: 3, semanticType: "QUANTITY" },
  { key: "fullName", label: "Nom", required: true, enabled: true, source: "customerField", askOrder: 4, semanticType: "PERSON_NAME" },
];

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

function item(input: Partial<CartItem> = {}): CartItem {
  return createCartItem({
    id: "review-item-one",
    productId,
    quantity: 1,
    selectedOptions: { size: "38", color: "black" },
    status: "COMPLETE",
    ...input,
  });
}

function reviewedCart(input: Partial<CartDraft> = {}): CartDraft {
  const items = input.items || [
    item({ id: "review-item-one", selectedOptions: { size: "38", color: "black" } }),
    item({ id: "review-item-two", selectedOptions: { size: "40", color: "pink" } }),
  ];
  const units = items.reduce((total, entry) => total + entry.quantity, 0);
  return {
    ...initializeCart(),
    mode: "STANDARD",
    status: "CART_REVIEW",
    targetItemCount: units,
    items,
    orderLevelFields: { fullName: "Omar" },
    ...input,
  };
}

function input({ cart: requestedCart, ...overrides }: Partial<CartReviewPreviewInput> = {}): CartReviewPreviewInput {
  const cart = requestedCart || reviewedCart();
  const lookup = new OfferConfigService().getConfiguredOffers({
    sellerId,
    productId,
    productContexts: [productContext],
  });
  return {
    previewEnabled: true,
    sellerId,
    productContext,
    requiredFields: fields,
    offerLookup: lookup,
    now: NOW,
    ...overrides,
    cart,
  };
}

function run(
  cart: CartDraft,
  rawActionId?: unknown,
  previewState?: CartReviewPreviewState,
  cartReviewText?: unknown,
  overrides: Partial<CartReviewPreviewInput> = {},
) {
  return runCartReviewPreview(input({
    ...overrides,
    cart,
    rawActionId,
    previewState,
    ...(cartReviewText !== undefined ? { cartReviewText } : {}),
  }));
}

function selectForEdit(cart: CartDraft, itemId: string, state?: CartReviewPreviewState) {
  const edit = run(cart, "cart_review:edit", state);
  const select = run(edit.cartAfter, `cart_review_item:select:${itemId}`, edit.previewState);
  const quantity = run(select.cartAfter, `cart_review_item:quantity:${itemId}`, select.previewState);
  return { edit, select, quantity };
}

/** Permanent preview-only vertical regression suite for Phase 6.3E cart review. */
export async function evaluateCartReview(): Promise<CartReviewEvaluationResult> {
  const cases: EvaluationCase[] = [];
  const initial = reviewedCart();
  const initialBefore = JSON.stringify(initial);
  const review = run(initial);

  add(cases, "completed target enters cart review", review.success && review.nextStep === "SHOW_CART_REVIEW" && review.review?.completedUnits === 2);
  add(cases, "review snapshot contains two different stable items", review.review?.items.length === 2 && review.review.items[0].id === "review-item-one" && review.review.items[1].id === "review-item-two");
  add(cases, "review progress counts quantities rather than lines", review.review?.completedUnits === 2 && review.review.cartLineCount === 2 && review.review.targetUnits === 2);
  add(cases, "main review returns Continue Add Edit", review.presentation?.uiHints?.options?.map((option) => option.id).join(",") === "cart_review:continue,cart_review:add_item,cart_review:edit");
  add(cases, "review uses server commercial pricing", review.review?.standardSubtotal === 398 && review.commercialEvaluation?.standardPricing?.standardSubtotal === 398);
  add(cases, "input cart is not mutated", JSON.stringify(initial) === initialBefore);
  add(cases, "review result is detached", review.cartBefore !== initial && review.cartAfter !== initial && Boolean(review.review && !Object.is(review.review.items, initial.items)));

  const incomplete = reviewedCart({ targetItemCount: 3 });
  add(cases, "incomplete cart cannot enter review", !run(incomplete).success && run(incomplete).failureCode === "TARGET_NOT_FULFILLED");
  const draft = createCartItem({ id: "review-draft", productId, status: "DRAFT" });
  add(cases, "cart with current draft cannot enter review", !run(reviewedCart({ status: "COLLECTING_ITEM", currentItemDraft: draft })).success);

  const edit = run(review.cartAfter, "cart_review:edit", review.previewState);
  add(cases, "edit returns item list with stable IDs", edit.success && edit.nextStep === "SELECT_CART_ITEM" && edit.presentation?.uiHints?.options?.[0]?.id === "cart_review_item:select:review-item-one");
  const selected = run(edit.cartAfter, "cart_review_item:select:review-item-one", edit.previewState);
  add(cases, "selecting an item returns focused option and remove actions", selected.success && selected.presentation?.uiHints?.options?.map((option) => option.id).join(",") === "cart_review_item:option:size:review-item-one,cart_review_item:option:color:review-item-one,cart_review_item:remove:review-item-one");
  const awaiting = run(selected.cartAfter, "cart_review_item:quantity:review-item-one", selected.previewState);
  add(cases, "quantity edit creates explicit awaiting state", awaiting.success && awaiting.nextStep === "ENTER_ITEM_QUANTITY" && awaiting.previewState.awaitingInput.kind === "EDIT_CART_ITEM_QUANTITY");
  const outsideQuantity = run(review.cartAfter, undefined, review.previewState, "2");
  add(cases, "quantity text is parsed only while awaiting", !outsideQuantity.handled && outsideQuantity.cartAfter.items[0].quantity === 1);

  const sameQuantity = run(awaiting.cartAfter, undefined, awaiting.previewState, "1");
  add(cases, "same quantity is idempotent", sameQuantity.success && !sameQuantity.changed && sameQuantity.cartAfter.items[0].quantity === 1);
  const increased = run(awaiting.cartAfter, undefined, awaiting.previewState, "2");
  add(cases, "increasing quantity updates only selected line", increased.success && increased.cartAfter.items[0].quantity === 2 && increased.cartAfter.items[1].quantity === 1);
  add(cases, "quantity update synchronizes target units", increased.cartAfter.targetItemCount === 3 && increased.review?.completedUnits === 3);
  add(cases, "quantity update triggers fresh commercial evaluation", increased.commercialEvaluation?.standardPricing?.totalUnits === 3 && increased.commercialEvaluation?.recommendedOffer?.offerId === "review-offer-three");
  add(cases, "order-level fields remain unchanged", increased.cartAfter.orderLevelFields.fullName === "Omar");
  add(cases, "completed item IDs remain stable", increased.cartAfter.items.map((entry) => entry.id).join(",") === "review-item-one,review-item-two");

  const decreaseFlow = selectForEdit(increased.cartAfter, "review-item-one", increased.previewState);
  const decreased = run(decreaseFlow.quantity.cartAfter, undefined, decreaseFlow.quantity.previewState, "1");
  add(cases, "decreasing quantity updates only selected line", decreased.success && decreased.cartAfter.items[0].quantity === 1 && decreased.cartAfter.items[1].quantity === 1 && decreased.cartAfter.targetItemCount === 2);
  for (const [name, text] of [["phone", "0612345678"], ["price", "199 MAD"], ["decimal", "1.5"], ["zero", "0"], ["negative", "-1"]] as const) {
    const rejected = run(awaiting.cartAfter, undefined, awaiting.previewState, text);
    add(cases, `${name} quantity is rejected without mutation`, !rejected.success && rejected.cartAfter.items[0].quantity === 1 && rejected.previewState.awaitingInput.kind === "EDIT_CART_ITEM_QUANTITY");
  }

  const removedSelection = run(edit.cartAfter, "cart_review_item:select:review-item-one", edit.previewState);
  const removed = run(removedSelection.cartAfter, "cart_review_item:remove:review-item-one", removedSelection.previewState);
  add(cases, "removing one of two items succeeds", removed.success && removed.changed && removed.cartAfter.items.length === 1 && removed.cartAfter.targetItemCount === 1);
  add(cases, "remaining item is preserved", removed.cartAfter.items[0].id === "review-item-two" && removed.cartAfter.items[0].selectedOptions.size === "40");
  const lastSelect = run(removed.cartAfter, "cart_review_item:select:review-item-two", removed.previewState);
  const lastRemove = run(lastSelect.cartAfter, "cart_review_item:remove:review-item-two", lastSelect.previewState);
  add(cases, "removing last item is blocked", !lastRemove.success && lastRemove.failureCode === "LAST_ITEM_REMOVAL_NOT_ALLOWED" && lastRemove.cartAfter.items.length === 1);
  const unknown = run(edit.cartAfter, "cart_review_item:select:does-not-exist", edit.previewState);
  add(cases, "unknown item ID is rejected", !unknown.success && unknown.failureCode === "UNKNOWN_CART_ITEM");
  for (const raw of ["cart_review_item:select:0", "cart_review_item:select:review item", "cart_review_item:select:review-item-one:extra", "cart_item_option:size:38", "cart_item_previous:same", "cart_offer:review-offer-two", "order:confirm"]) {
    const normalized = normalizeCartReviewAction(raw);
    add(cases, `${raw} is not accepted as a review item authority`, !normalized.valid || !normalized.recognized);
  }

  const addItem = run(review.cartAfter, "cart_review:add_item", review.previewState);
  add(cases, "add item increases target by exactly one", addItem.success && addItem.cartAfter.targetItemCount === 3);
  add(cases, "add item starts exactly one current draft", Boolean(addItem.cartAfter.currentItemDraft) && addItem.cartAfter.status === "COLLECTING_ITEM" && addItem.cartAfter.items.length === 2);
  add(cases, "add item returns Same Different shortcut when eligible", addItem.itemCollectionPreview?.shortcutPresentation?.promptKey === "SAME_OR_DIFFERENT_ITEM_OPTIONS");
  const addReplay = run(addItem.cartAfter, "cart_review:add_item", addItem.previewState);
  add(cases, "add item replay does not duplicate draft or target", !addReplay.success && addReplay.cartAfter.targetItemCount === 3 && Boolean(addReplay.cartAfter.currentItemDraft));
  const optionlessFields = fields.filter((field) => field.source === "customerField");
  const optionlessCart = reviewedCart({ items: [item({ id: "optionless-one", selectedOptions: {} })], targetItemCount: 1 });
  const optionlessReview = run(optionlessCart, undefined, undefined, undefined, { requiredFields: optionlessFields });
  const optionlessAdd = run(optionlessReview.cartAfter, "cart_review:add_item", optionlessReview.previewState, undefined, { requiredFields: optionlessFields });
  add(cases, "add item works for option-less product", optionlessAdd.success && optionlessAdd.itemCollectionPreview?.nextStep === "ENTER_ITEM_QUANTITY" && !optionlessAdd.itemCollectionPreview?.shortcutPresentation);

  const continued = run(review.cartAfter, "cart_review:continue", review.previewState);
  add(cases, "continue returns delivery readiness metadata", continued.success && !continued.changed && continued.nextStep === "DELIVERY_COLLECTION_READY");
  add(cases, "continue does not collect delivery confirm save or receipt", continued.cartAfter.status === "CART_REVIEW" && !continued.cartAfter.currentItemDraft && continued.cartAfter.orderLevelFields.fullName === "Omar" && !continued.planningResult);
  const prematureStandard = run(review.cartAfter, "cart_review:use_standard", review.previewState);
  add(cases, "use standard requires an explicit selected-offer loss", !prematureStandard.success && prematureStandard.failureCode === "SELECTED_OFFER_NOT_INELIGIBLE");

  const eligibleOfferCart = reviewedCart({
    mode: "OFFER",
    selectedOfferId: "review-offer-two",
    targetItemCount: 2,
    items: [item({ id: "eligible-offer-line", quantity: 2, selectedOptions: { size: "38", color: "black" } })],
  });
  const eligibleOffer = run(eligibleOfferCart);
  add(cases, "selected eligible offer remains selected", eligibleOffer.success && eligibleOffer.commercialEvaluation?.state === "SELECTED_OFFER_ELIGIBLE" && eligibleOffer.cartAfter.selectedOfferId === "review-offer-two");
  const offerQuantity = selectForEdit(eligibleOffer.cartAfter, "eligible-offer-line", eligibleOffer.previewState);
  const offerLost = run(offerQuantity.quantity.cartAfter, undefined, offerQuantity.quantity.previewState, "3");
  add(cases, "offer lost after quantity edit is surfaced", offerLost.success && offerLost.commercialEvaluation?.state === "SELECTED_OFFER_INELIGIBLE" && offerLost.nextStep === "RESOLVE_COMMERCIAL_STATE");
  const blockedContinue = run(offerLost.cartAfter, "cart_review:continue", offerLost.previewState);
  add(cases, "continue is blocked while selected offer is ineligible", !blockedContinue.success && blockedContinue.failureCode === "SELECTED_OFFER_INELIGIBLE");
  const acceptedStandard = run(offerLost.cartAfter, "cart_review:use_standard", offerLost.previewState);
  add(cases, "use standard clears selected offer through planning boundary", acceptedStandard.success && acceptedStandard.cartAfter.mode === "STANDARD" && !acceptedStandard.cartAfter.selectedOfferId && acceptedStandard.cartAfter.targetItemCount === 3);
  const acceptedStandardReplay = run(acceptedStandard.cartAfter, "cart_review:use_standard", acceptedStandard.previewState);
  add(cases, "use standard twice is safe", acceptedStandardReplay.success && !acceptedStandardReplay.changed && acceptedStandardReplay.cartAfter.mode === "STANDARD");
  const recommendedCart = reviewedCart({
    targetItemCount: 2,
    items: [item({ id: "recommended-line", quantity: 2, selectedOptions: { size: "38", color: "black" } })],
  });
  const recommended = run(recommendedCart);
  add(cases, "recommended offer is never auto-selected", recommended.success && !recommended.cartAfter.selectedOfferId && recommended.commercialEvaluation?.recommendedOffer?.offerId === "review-offer-two");

  const sourceFiles = [
    "cart-review.types.ts",
    "cart-review.service.ts",
    "cart-review-presentation.service.ts",
    "cart-review-action.service.ts",
    "cart-review-preview.service.ts",
  ].map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "cart-review", file), "utf8")).join("\n");
  add(cases, "cart review has no Valkey or session persistence", !/from\s+["'][^"']*(?:session|valkey|redis|database|prisma|typeorm)/i.test(sourceFiles));
  add(cases, "cart review has no AI Cloud Meta receipt DB or queue dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain|whatsapp|cloud|meta|receipt|valkey|redis|database|prisma|typeorm|bull|queue)/i.test(sourceFiles));
  add(cases, "cart review owns no global mutable state", !/^(?:let|var)\s+/m.test(sourceFiles));
  add(cases, "cart review does not implement option replacement", !/selectedOptions\s*=/.test(sourceFiles));

  const d3 = await evaluateSameAsPrevious();
  const d2d = await evaluateItemCollectionLoop();
  const b3 = evaluateCartCommercialIntegration();
  const b2 = evaluateCartPricing();
  const c1 = evaluateCartPlanning();
  const planningPreview = evaluateCartPlanningPreview();
  add(cases, "D3 regression remains passing", d3.failed === 0);
  add(cases, "D2D regression remains passing", d2d.failed === 0);
  add(cases, "B3 regression remains passing", b3.summary.failed === 0);
  add(cases, "B2 regression remains passing", b2.summary.failed === 0);
  add(cases, "C1 regression remains passing", c1.failed === 0);
  add(cases, "planning preview regression remains passing", planningPreview.failed === 0);

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
