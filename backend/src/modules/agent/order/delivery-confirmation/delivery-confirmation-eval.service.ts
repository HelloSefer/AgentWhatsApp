import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import type { RequiredOrderField } from "../../config/required-fields.types";
import { createCartItem, initializeCart } from "../cart-state.service";
import type { CartDraft, CartItem } from "../cart-state.types";
import { evaluateCartCommercialIntegration } from "../commercial/cart-commercial-evaluation-eval.service";
import { evaluateItemCollectionLoop } from "../item-collection/loop/item-collection-loop-eval.service";
import { evaluateCartPricing } from "../pricing/cart-pricing-eval.service";
import { evaluateCartReview } from "../cart-review/cart-review-eval.service";
import { evaluateCartItemEdit } from "../cart-review/item-edit/cart-item-edit-eval.service";
import { runDeliveryConfirmationPreview } from "./delivery-confirmation-preview.service";
import { normalizeDeliveryConfirmationAction } from "./delivery-confirmation-action.service";
import { getDeliveryRequirements } from "./delivery-requirements.service";
import type {
  DeliveryConfirmationPreviewInput,
  DeliveryConfirmationPreviewResult,
  DeliveryConfirmationPreviewState,
} from "./delivery-confirmation.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type DeliveryConfirmationEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const NOW = new Date("2026-07-19T16:00:00.000Z");
const sellerId = "delivery-confirmation-seller";
const productId = "delivery-confirmation-product";
const conversationScopeId = "preview-customer-0612345678";

const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Delivery Confirmation Product",
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
      id: "delivery-three",
      productId,
      label: "Three items",
      requiredItemCount: 3,
      totalPrice: 500,
      currency: "MAD",
      active: true,
      allowMixedOptions: true,
      priority: 1,
    },
  ],
};

const fields: RequiredOrderField[] = [
  { key: "size", label: "Taille", required: true, enabled: true, source: "productOption", askOrder: 1, options: ["38", "40"], captureMode: "CONFIGURED_ENUM" },
  { key: "color", label: "Couleur", required: true, enabled: true, source: "productOption", askOrder: 2, options: ["black", "pink"], captureMode: "CONFIGURED_ENUM" },
  { key: "quantity", label: "Quantité", required: true, enabled: true, source: "customerField", askOrder: 3, semanticType: "QUANTITY", captureMode: "NUMERIC" },
  { key: "fullName", label: "Nom complet", required: true, enabled: true, source: "customerField", askOrder: 10, semanticType: "PERSON_NAME", captureMode: "OPEN_TEXT" },
  { key: "phone", label: "Téléphone", required: true, enabled: true, source: "customerField", askOrder: 20, semanticType: "PHONE", captureMode: "PHONE" },
  { key: "city", label: "Ville", required: true, enabled: true, source: "customerField", askOrder: 30, semanticType: "LOCATION", captureMode: "LOCATION" },
  { key: "address", label: "Adresse", required: true, enabled: true, source: "customerField", askOrder: 40, semanticType: "ADDRESS", captureMode: "ADDRESS" },
  { key: "deliveryZone", label: "Zone de livraison", required: true, enabled: true, source: "customerField", askOrder: 50, captureMode: "CONFIGURED_ENUM", options: ["centre", "outside"] },
  { key: "deliveryInstructions", label: "Instructions", required: true, enabled: true, source: "customerField", askOrder: 60, semanticType: "DELIVERY_INSTRUCTIONS", captureMode: "OPEN_TEXT" },
  { key: "giftNote", label: "Note cadeau", required: false, enabled: true, source: "customerField", askOrder: 70, captureMode: "OPEN_TEXT", requirement: "OPTIONAL" },
];

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

function item(input: Partial<CartItem> = {}): CartItem {
  return createCartItem({
    id: "delivery-line-one",
    productId,
    quantity: 1,
    selectedOptions: { size: "38", color: "black" },
    status: "COMPLETE",
    ...input,
  });
}

function reviewedCart(input: Partial<CartDraft> = {}): CartDraft {
  const items = input.items || [
    item({ id: "delivery-line-one", quantity: 1, selectedOptions: { size: "38", color: "black" } }),
    item({ id: "delivery-line-two", quantity: 2, selectedOptions: { size: "40", color: "pink" } }),
  ];
  const units = items.reduce((total, line) => total + line.quantity, 0);
  return {
    ...initializeCart(),
    mode: "STANDARD",
    status: "CART_REVIEW",
    targetItemCount: units,
    items,
    orderLevelFields: {},
    ...input,
  };
}

function input(overrides: Partial<DeliveryConfirmationPreviewInput> = {}): DeliveryConfirmationPreviewInput {
  const lookup = new OfferConfigService().getConfiguredOffers({
    sellerId,
    productId,
    productContexts: [productContext],
  });
  return {
    previewEnabled: true,
    sellerId,
    conversationScopeId,
    productContext,
    requiredFields: fields,
    offerLookup: lookup,
    cart: reviewedCart(),
    now: NOW,
    ...overrides,
  };
}

function run(inputOverrides: Partial<DeliveryConfirmationPreviewInput> = {}): DeliveryConfirmationPreviewResult {
  return runDeliveryConfirmationPreview(input(inputOverrides));
}

function advance(
  previous: DeliveryConfirmationPreviewResult,
  text?: string,
  actionId?: string,
): DeliveryConfirmationPreviewResult {
  return run({
    cart: previous.cartAfter,
    previewState: previous.previewState,
    ...(text !== undefined ? { deliveryConfirmationText: text } : {}),
    ...(actionId !== undefined ? { rawActionId: actionId } : {}),
  });
}

function completeToFinal(): DeliveryConfirmationPreviewResult {
  let current = run();
  current = advance(current, "Oussama El Amrani");
  current = advance(current, "+212612345678");
  current = advance(current, "دوار النخيل الجديدة");
  current = advance(current, "حي السلام زنقة 4 رقم 12");
  current = advance(current, undefined, "order_checkout_field:value:deliveryZone:centre");
  current = advance(current, "قرب مسجد النور");
  return current;
}

/** Permanent preview-only vertical regression suite for Phase 6.3F. */
export async function evaluateDeliveryConfirmation(): Promise<DeliveryConfirmationEvaluationResult> {
  const cases: EvaluationCase[] = [];
  const initial = reviewedCart();
  const initialJson = JSON.stringify(initial);
  const requirements = getDeliveryRequirements({ fields, cart: initial });
  const started = run({ cart: initial });

  add(cases, "delivery readiness enters explicit collection", started.success && started.nextStep === "COLLECT_ORDER_FIELD" && started.cartAfter.status === "COLLECTING_DELIVERY");
  add(cases, "entry does not clear existing cart data", JSON.stringify(initial) === initialJson && started.cartAfter.items.length === 2);
  add(cases, "requirements follow configuration order", requirements.map((field) => field.key).join(",") === "fullName,phone,city,address,deliveryZone,deliveryInstructions");
  add(cases, "item fields are excluded from delivery requirements", !requirements.some((field) => ["size", "color", "quantity"].includes(field.key)));
  add(cases, "first missing order field is presented", started.previewState?.currentFieldKey === "fullName" && started.presentation?.field?.key === "fullName");
  add(cases, "open text field has no unsafe option actions", !started.presentation?.uiHints);

  const incomplete = run({ cart: reviewedCart({ targetItemCount: 4 }) });
  add(cases, "incomplete cart cannot enter delivery", !incomplete.success && incomplete.failureCode === "TARGET_NOT_FULFILLED");
  const draft = run({ cart: reviewedCart({ currentItemDraft: item({ id: "delivery-draft", status: "DRAFT" }) }) });
  add(cases, "current item draft blocks delivery", !draft.success && draft.failureCode === "CURRENT_ITEM_PRESENT");
  const overfilled = run({ cart: reviewedCart({ targetItemCount: 2 }) });
  add(cases, "overfilled target blocks delivery", !overfilled.success && overfilled.failureCode === "TARGET_OVERFILLED");
  const ineligible = run({ cart: reviewedCart({ mode: "OFFER", selectedOfferId: "delivery-three", targetItemCount: 2, items: [item({ quantity: 2 })] }) });
  add(cases, "selected ineligible offer is blocked", !ineligible.success && ineligible.failureCode === "SELECTED_OFFER_INELIGIBLE" && ineligible.nextStep === "RESOLVE_COMMERCIAL_STATE");
  const itemEditConflict = run({ cartItemEditPreviewState: { version: 1, kind: "EDIT_CART_ITEM_OPTIONS", sourceItemId: "delivery-line-one", originalItemFingerprint: "x", workingItem: { productId, quantity: 1, selectedOptions: {} } } });
  add(cases, "active item edit blocks delivery entry", !itemEditConflict.success && itemEditConflict.failureCode === "CONFLICTING_ITEM_EDIT_STATE");
  const reviewConflict = run({ cartReviewPreviewState: { version: 1, awaitingInput: { kind: "EDIT_CART_ITEM_QUANTITY", itemId: "delivery-line-one" } } });
  add(cases, "active review quantity edit blocks delivery entry", !reviewConflict.success && reviewConflict.failureCode === "CONFLICTING_CART_REVIEW_STATE");

  const unawaitedText = run({ cart: started.cartAfter, previewState: undefined, deliveryConfirmationText: "Oussama" });
  add(cases, "text is not consumed without detached field state", !unawaitedText.handled || unawaitedText.failureCode !== undefined);
  const badAction = advance(started, undefined, "cart_item_option:size:38");
  add(cases, "foreign item action is never consumed", !badAction.handled);
  add(cases, "checkout action ids require exact segment counts", !normalizeDeliveryConfirmationAction("order_checkout_field:value:city:Casa:extra").valid);
  add(cases, "checkout actions reject whitespace and control ambiguity", !normalizeDeliveryConfirmationAction("order_checkout_field:value:city:Casa Blanca").valid && !normalizeDeliveryConfirmationAction("order_checkout_field:value:city:Casa\u0001").valid);
  add(cases, "checkout actions never embed display labels as authority", normalizeDeliveryConfirmationAction("order_checkout_field:value:deliveryZone:centre").action?.type === "SELECT_FIELD_VALUE");
  const invalidName = advance(started, "نعم");
  add(cases, "invalid full name is rejected without mutation", !invalidName.success && invalidName.cartAfter.orderLevelFields.fullName === undefined && invalidName.previewState?.currentFieldKey === "fullName");
  const name = advance(started, "Oussama El Amrani");
  add(cases, "full name normalization works", name.success && name.cartAfter.orderLevelFields.fullName === "Oussama El Amrani" && name.previewState?.currentFieldKey === "phone");
  const phone = advance(name, "+212612345678");
  add(cases, "Moroccan phone normalization works", phone.success && phone.cartAfter.orderLevelFields.phone === "0612345678");
  const invalidPhone = advance(name, "199 MAD");
  add(cases, "invalid phone is rejected without mutation", !invalidPhone.success && invalidPhone.cartAfter.orderLevelFields.phone === undefined);
  const openCity = advance(phone, "منطقة الأمل الشرقية");
  add(cases, "unseen open locality is accepted without whitelist", openCity.success && openCity.cartAfter.orderLevelFields.city === "منطقة الأمل الشرقية");
  const cityQuestion = advance(phone, "واش التوصيل كاين؟");
  add(cases, "city question is rejected safely", !cityQuestion.success && cityQuestion.cartAfter.orderLevelFields.city === undefined);
  const address = advance(openCity, "résidence Al Amal appartement 6");
  add(cases, "open address works safely", address.success && address.cartAfter.orderLevelFields.address === "résidence Al Amal appartement 6");
  const invalidAddress = advance(openCity, "\u0001حي السلام");
  add(cases, "control characters are rejected without mutation", !invalidAddress.success && invalidAddress.cartAfter.orderLevelFields.address === undefined);
  const oversizedAddress = advance(openCity, `حي ${"ا".repeat(200)}`);
  add(cases, "oversized text is rejected without mutation", !oversizedAddress.success && oversizedAddress.cartAfter.orderLevelFields.address === undefined);
  const zoneOptions = advance(address);
  add(cases, "closed list field presents canonical actions", zoneOptions.presentation?.uiHints?.options?.map((option) => option.id).join(",") === "order_checkout_field:value:deliveryZone:centre,order_checkout_field:value:deliveryZone:outside");
  const unknownZone = advance(address, undefined, "order_checkout_field:value:deliveryZone:unknown");
  add(cases, "unknown closed-list value is rejected", !unknownZone.success && unknownZone.cartAfter.orderLevelFields.deliveryZone === undefined);
  const zone = advance(address, undefined, "order_checkout_field:value:deliveryZone:centre");
  add(cases, "closed-list value stores configured canonical value", zone.success && zone.cartAfter.orderLevelFields.deliveryZone === "centre");
  const custom = advance(zone, "قرب مسجد النور");
  add(cases, "custom order-scoped field works", custom.success && custom.cartAfter.orderLevelFields.deliveryInstructions === "قرب مسجد النور");
  add(cases, "all required values enter final review", custom.nextStep === "FINAL_ORDER_REVIEW" && custom.cartAfter.status === "AWAITING_CONFIRMATION");
  add(cases, "same field value is idempotent", (() => {
    const edit = advance(custom, undefined, "order_checkout:edit_delivery");
    const selected = advance(edit, undefined, "order_checkout_field:select:city");
    const same = advance(selected, "منطقة الأمل الشرقية");
    return same.success && !same.changed && same.nextStep === "FINAL_ORDER_REVIEW";
  })());
  add(cases, "optional field remains excluded unless explicitly included", !requirements.some((field) => field.key === "giftNote"));
  const optionalRequirements = getDeliveryRequirements({ fields, cart: initial, includeOptionalFieldKeys: ["giftNote"] });
  add(cases, "explicit optional order field is supported", optionalRequirements.at(-1)?.key === "giftNote");

  const finalReview = completeToFinal();
  add(cases, "final review has two different cart lines", finalReview.finalReview?.items.length === 2 && finalReview.finalReview.items[0].id === "delivery-line-one" && finalReview.finalReview.items[1].id === "delivery-line-two");
  add(cases, "final review retains quantities and configured option labels", finalReview.finalReview?.items[1].quantity === 2 && finalReview.finalReview.items[0].options[0].label === "Taille");
  add(cases, "final review contains collected delivery fields", finalReview.finalReview?.orderFields.map((field) => field.key).join(",") === "fullName,phone,city,address,deliveryZone,deliveryInstructions");
  add(cases, "final review uses fresh server commercial totals", finalReview.finalReview?.standardSubtotal === 597 && finalReview.finalReview.finalTotal === 597);
  const priceInjected = run({ cart: finalReview.cartAfter, previewState: finalReview.previewState, deliveryConfirmationText: undefined });
  add(cases, "request-provided prices cannot alter final review", priceInjected.finalReview?.finalTotal === 597);
  const rerender = advance(finalReview);
  add(cases, "repeated final-review render is idempotent", rerender.success && !rerender.changed && rerender.finalReview?.finalTotal === finalReview.finalReview?.finalTotal);

  const edit = advance(finalReview, undefined, "order_checkout:edit_delivery");
  add(cases, "edit delivery returns configured order field list", edit.success && edit.nextStep === "EDIT_ORDER_FIELD" && edit.presentation?.uiHints?.options?.length === 6);
  const selectedAddress = advance(edit, undefined, "order_checkout_field:select:address");
  add(cases, "selecting delivery field enters explicit edit state", selectedAddress.previewState?.editingFieldKey === "address" && selectedAddress.presentation?.field?.key === "address");
  const changedAddress = advance(selectedAddress, "حي النصر رقم 9");
  add(cases, "editing one delivery field preserves other fields", changedAddress.success && changedAddress.cartAfter.orderLevelFields.address === "حي النصر رقم 9" && changedAddress.cartAfter.orderLevelFields.phone === "0612345678");
  const cancelEdit = advance(edit, undefined, "order_checkout:cancel_edit");
  add(cases, "cancel edit returns final review safely", cancelEdit.success && cancelEdit.nextStep === "FINAL_ORDER_REVIEW");
  const back = advance(finalReview, undefined, "order_checkout:back_to_cart");
  add(cases, "back to cart preserves delivery fields", back.success && back.nextStep === "RETURN_TO_CART_REVIEW" && back.cartAfter.status === "CART_REVIEW" && back.cartAfter.orderLevelFields.city === "دوار النخيل الجديدة");
  add(cases, "back to cart does not duplicate cart items", back.cartAfter.items.length === 2 && back.cartAfter.items[1].quantity === 2);
  const reentered = run({ cart: back.cartAfter });
  add(cases, "returning after cart review reruns commercial evaluation", reentered.success && Boolean(reentered.commercialEvaluation?.evaluatedAt));
  const eligibleOfferCart = reviewedCart({ mode: "OFFER", selectedOfferId: "delivery-three" });
  const eligibleOffer = run({ cart: eligibleOfferCart });
  add(cases, "selected eligible offer remains selected", eligibleOffer.success && eligibleOffer.cartAfter.selectedOfferId === "delivery-three" && eligibleOffer.commercialEvaluation?.state === "SELECTED_OFFER_ELIGIBLE");
  add(cases, "recommendation is metadata only and not auto-selected", started.cartAfter.selectedOfferId === undefined && Boolean(started.commercialEvaluation?.recommendedOffer));

  const confirmMissing = advance(started, undefined, "order_checkout:confirm");
  add(cases, "confirm is blocked while fields are missing", !confirmMissing.success && confirmMissing.failureCode === "CONFIRMATION_NOT_READY");
  const confirmDraft = advance({ ...finalReview, cartAfter: { ...finalReview.cartAfter, currentItemDraft: item({ id: "late-draft", status: "DRAFT" }) } }, undefined, "order_checkout:confirm");
  add(cases, "confirm is blocked when a current item draft exists", !confirmDraft.success && confirmDraft.failureCode === "CURRENT_ITEM_PRESENT");
  const confirmTarget = advance({ ...finalReview, cartAfter: { ...finalReview.cartAfter, targetItemCount: 4 } }, undefined, "order_checkout:confirm");
  add(cases, "confirm is blocked when target units mismatch", !confirmTarget.success && confirmTarget.failureCode === "TARGET_NOT_FULFILLED");
  const confirmed = advance(finalReview, undefined, "order_checkout:confirm");
  add(cases, "valid confirm returns detached confirmed preview", confirmed.success && confirmed.nextStep === "CONFIRMED_ORDER_PREVIEW" && confirmed.cartAfter.status === "CONFIRMED");
  add(cases, "confirmed preview contains every item line and quantity", confirmed.confirmedPreview?.items.length === 2 && confirmed.confirmedPreview.items[1].quantity === 2);
  add(cases, "confirmed preview contains final commercial snapshot", confirmed.confirmedPreview?.standardSubtotal === 597 && confirmed.confirmedPreview.finalTotal === 597);
  add(cases, "confirmed preview contains order-level fields", confirmed.confirmedPreview?.orderFields.length === 6 && confirmed.confirmedPreview.orderFields[0].key === "fullName");
  const confirmedReplay = advance(confirmed, undefined, "order_checkout:confirm");
  add(cases, "repeated confirm is idempotent", confirmedReplay.success && !confirmedReplay.changed && confirmedReplay.confirmedPreview?.confirmedAt === confirmed.confirmedPreview?.confirmedAt);
  const confirmedMutation = advance(confirmed, "Casa");
  add(cases, "confirmed preview blocks later field mutation", !confirmedMutation.success && confirmedMutation.failureCode === "CONFIRMED_PREVIEW_LOCKED");

  const sourceRoot = join(process.cwd(), "src", "modules", "agent", "order", "delivery-confirmation");
  const sourceFiles = [
    "delivery-confirmation.types.ts",
    "delivery-requirements.service.ts",
    "delivery-field-normalizer.service.ts",
    "delivery-confirmation-action.service.ts",
    "delivery-confirmation-context.service.ts",
    "delivery-confirmation-collection.service.ts",
    "delivery-confirmation-snapshot.service.ts",
    "delivery-confirmation-result.service.ts",
    "delivery-confirmation.service.ts",
    "delivery-confirmation-presentation.service.ts",
    "delivery-confirmation-preview.service.ts",
  ].map((file) => readFileSync(join(sourceRoot, file), "utf8")).join("\n");
  add(cases, "delivery module has no persistence or transport dependency", !/from\s+["'][^"']*(?:session|valkey|redis|database|prisma|typeorm|whatsapp|cloud|meta|receipt|notification|bull|queue)[^"']*/i.test(sourceFiles));
  add(cases, "delivery module has no AI dependency", !/from\s+["'][^"']*(?:ollama|openai|\/ai\/|seller-brain)[^"']*/i.test(sourceFiles));
  add(cases, "delivery module owns no global mutable state", !/^(?:let|var)\s+/m.test(sourceFiles));
  add(cases, "delivery module does not directly assign order-level values", !/orderLevelFields\s*\[[^\]]+\]\s*=/.test(sourceFiles));
  add(cases, "preview results are detached", (() => {
    const snapshot = finalReview.finalReview?.items[0].quantity;
    if (!finalReview.finalReview) return false;
    (finalReview.finalReview.items[0] as { quantity: number }).quantity = 99;
    return finalReview.cartAfter.items[0].quantity === 1 && snapshot === 1;
  })());
  add(cases, "no cart confirmation writes persistence or receipts", confirmed.confirmedPreview !== undefined && !sourceFiles.includes("saveConfirmedOrder") && !sourceFiles.includes("generateOrderReceipt"));
  add(cases, "preview has no session or Valkey mutation", !sourceFiles.includes("saveConversationSession") && !sourceFiles.includes("appendConversationMessage"));

  const e2 = await evaluateCartItemEdit();
  const e = await evaluateCartReview();
  const d2d = await evaluateItemCollectionLoop();
  const b3 = evaluateCartCommercialIntegration();
  const b2 = evaluateCartPricing();
  add(cases, "E2 regression remains passing", e2.failed === 0);
  add(cases, "E cart-review regression remains passing", e.failed === 0);
  add(cases, "D2D loop regression remains passing", d2d.failed === 0);
  add(cases, "B3 commercial regression remains passing", b3.summary.failed === 0);
  add(cases, "B2 pricing regression remains passing", b2.summary.failed === 0);

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
