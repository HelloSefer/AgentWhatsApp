import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addItem, createCartItem, mergeCompatibleItems, removeItem, updateItem } from "../cart-state.service";
import type { CartDraft, CartItem } from "../cart-state.types";
import { OfferConfigService } from "../../config/offers/offer-config.service";
import type { ProductOfferConfig } from "../../config/offers/offer.types";
import type { ProductContext } from "../../config/product-context.types";
import {
  compareCommercialEvaluations,
  evaluateCartCommercialState,
} from "./cart-commercial-evaluation.service";

type EvaluationResult = { name: string; passed: boolean; details?: string };

const NOW = new Date("2026-07-18T12:00:00.000Z");

function offer(input: Partial<ProductOfferConfig> = {}): ProductOfferConfig {
  return {
    id: "offer-two",
    productId: "commercial-product",
    label: "جوج ب 349",
    requiredItemCount: 2,
    totalPrice: 349,
    currency: "MAD",
    active: true,
    allowMixedOptions: false,
    priority: 10,
    ...input,
  };
}

function product(input: Partial<ProductContext> = {}): ProductContext {
  return {
    sellerId: "commercial-seller",
    productId: "commercial-product",
    name: "منتج تجاري",
    price: 199,
    currency: "MAD",
    active: true,
    images: [],
    benefits: [],
    optionGroups: [],
    infoMenu: [],
    stock: { enabled: false, status: "AVAILABLE" },
    ...input,
  };
}

function item(input: Partial<CartItem> = {}): CartItem {
  return createCartItem({
    id: "commercial-item-1",
    productId: "commercial-product",
    quantity: 1,
    selectedOptions: {},
    status: "COMPLETE",
    ...input,
  });
}

function cart(input: Partial<CartDraft> = {}): CartDraft {
  const items = input.items || [];
  return {
    schemaVersion: 1,
    mode: "STANDARD",
    status: items.length ? "CART_REVIEW" : "EMPTY",
    items,
    orderLevelFields: {},
    ...input,
  };
}

function commercialInput(input: {
  currentCart: CartDraft;
  currentProduct: ProductContext;
  sellerId?: string;
  now?: Date;
}) {
  const sellerId = input.sellerId || input.currentProduct.sellerId;
  const offerLookup = new OfferConfigService().getConfiguredOffers({
    sellerId,
    productId: input.currentProduct.productId,
    productContexts: [input.currentProduct],
  });
  return {
    sellerId,
    productContext: input.currentProduct,
    cart: input.currentCart,
    now: input.now || NOW,
    offerLookup,
  };
}

function hasFailure(result: { failures: readonly { code: string }[] }, code: string): boolean {
  return result.failures.some((failure) => failure.code === code);
}

/** Permanent B3 orchestration coverage. It does not call messaging or runtime handlers. */
export function evaluateCartCommercialIntegration(): {
  summary: { total: number; passed: number; failed: number; passedAll: boolean };
  results: EvaluationResult[];
} {
  const results: EvaluationResult[] = [];
  const add = (name: string, passed: boolean, details?: string) => results.push({ name, passed, details });
  const twoOfferProduct = product({ offers: [offer()] });
  const oneItemCart = cart({ items: [item()] });
  const one = evaluateCartCommercialState(commercialInput({ currentCart: oneItemCart, currentProduct: twoOfferProduct }));
  const mergedTwoCart = addItem({ cart: oneItemCart, item: item({ id: "commercial-item-2" }) }).cart;
  const two = evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: twoOfferProduct }));

  add("one item returns standard pricing without eligible two-item offer", one.standardPricing?.merchandiseTotal === 199 && one.eligibleOffers.length === 0);
  add("adding identical second item makes two-item offer eligible", two.eligibleOffers.some((entry) => entry.offerId === "offer-two") && two.recommendedOffer?.offerId === "offer-two");

  const mixedCart = cart({
    items: [
      item({ id: "mixed-red", selectedOptions: { color: "أحمر" } }),
      item({ id: "mixed-black", selectedOptions: { color: "أسود" } }),
    ],
  });
  const mixedAllowed = evaluateCartCommercialState(commercialInput({ currentCart: mixedCart, currentProduct: product({ offers: [offer({ allowMixedOptions: true })] }) }));
  const mixedBlockedProduct = product({ offers: [offer({ allowMixedOptions: false })] });
  const mixedBlocked = evaluateCartCommercialState(commercialInput({ currentCart: mixedCart, currentProduct: mixedBlockedProduct }));
  add("different options are eligible when mixing is allowed", mixedAllowed.eligibleOffers.length === 1);
  add("different options are ineligible when mixing is blocked", mixedBlocked.eligibleOffers.length === 0 && mixedBlocked.state === "STANDARD_ONLY");

  const selectedMixed = cart({ ...mixedCart, selectedOfferId: "offer-two" });
  const selectedBlocked = evaluateCartCommercialState(commercialInput({ currentCart: selectedMixed, currentProduct: mixedBlockedProduct }));
  add("editing options can make selected offer ineligible", selectedBlocked.state === "SELECTED_OFFER_INELIGIBLE" && selectedBlocked.selectedOffer?.failureCode === "MIXED_OPTIONS_NOT_ALLOWED");
  const editedMatching = updateItem({ cart: selectedMixed, itemId: "mixed-black", selectedOptions: { color: "أحمر" } }).cart;
  const mergedMatching = mergeCompatibleItems(editedMatching).cart;
  const restored = evaluateCartCommercialState(commercialInput({ currentCart: mergedMatching, currentProduct: mixedBlockedProduct }));
  add("editing options back then merging restores eligibility", restored.selectedOffer?.eligible === true && restored.state === "SELECTED_OFFER_ELIGIBLE");

  const removed = removeItem({ cart: mergedMatching, itemId: mergedMatching.items[0].id }).cart;
  const afterRemoval = evaluateCartCommercialState(commercialInput({ currentCart: removed, currentProduct: mixedBlockedProduct }));
  add("removing one item invalidates selected two-item offer", afterRemoval.selectedOffer?.eligible === false && hasFailure(afterRemoval, "EMPTY_CART"));
  add("standard pricing remains available when selected offer becomes ineligible", selectedBlocked.standardPricing?.merchandiseTotal === 398 && !selectedBlocked.selectedOffer?.pricing);

  const selectedThreeProduct = product({
    offers: [
      offer({ id: "offer-two", priority: 2 }),
      offer({ id: "offer-three", requiredItemCount: 3, totalPrice: 459, priority: 1, allowMixedOptions: true }),
    ],
  });
  const selectedThreeCart = cart({ ...mergedTwoCart, selectedOfferId: "offer-three" });
  const selectedNotReplaced = evaluateCartCommercialState(commercialInput({ currentCart: selectedThreeCart, currentProduct: selectedThreeProduct }));
  add("explicit selected offer is never replaced by recommended offer", selectedNotReplaced.selectedOffer?.offerId === "offer-three" && selectedNotReplaced.selectedOffer.eligible === false && selectedNotReplaced.recommendedOffer?.offerId === "offer-two");
  add("other eligible offers remain visible separately", selectedNotReplaced.eligibleOffers.some((entry) => entry.offerId === "offer-two"));

  const separateTwoCart = cart({
    items: [
      item({ id: "separate-one", selectedOptions: { color: "أحمر" } }),
      item({ id: "separate-two", selectedOptions: { color: "أسود" } }),
    ],
  });
  const mixedTwoProduct = product({ offers: [offer({ allowMixedOptions: true })] });
  const separateTwo = evaluateCartCommercialState(commercialInput({ currentCart: separateTwoCart, currentProduct: mixedTwoProduct }));
  const mergedTwo = evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: mixedTwoProduct }));
  add("merged and separate two units have equivalent eligibility and subtotal", separateTwo.eligibleOffers.length === 1 && mergedTwo.eligibleOffers.length === 1 && separateTwo.standardPricing?.standardSubtotal === mergedTwo.standardPricing?.standardSubtotal);

  const quantityThreeCart = updateItem({ cart: mergedTwoCart, itemId: mergedTwoCart.items[0].id, quantity: 3 }).cart;
  const quantityThree = evaluateCartCommercialState(commercialInput({ currentCart: quantityThreeCart, currentProduct: twoOfferProduct }));
  add("quantity change from two to three re-evaluates count", quantityThree.eligibleOffers.length === 0);
  const threeOfferProduct = product({ offers: [offer({ id: "offer-three", requiredItemCount: 3, totalPrice: 459, allowMixedOptions: true })] });
  const threeRecommended = evaluateCartCommercialState(commercialInput({ currentCart: quantityThreeCart, currentProduct: threeOfferProduct }));
  add("third unit can make three-item offer recommended", threeRecommended.recommendedOffer?.offerId === "offer-three");
  const backToTwo = updateItem({ cart: quantityThreeCart, itemId: quantityThreeCart.items[0].id, quantity: 2 }).cart;
  const twoRecommendedAgain = evaluateCartCommercialState(commercialInput({ currentCart: backToTwo, currentProduct: twoOfferProduct }));
  add("removing a unit can make two-item offer recommended again", twoRecommendedAgain.recommendedOffer?.offerId === "offer-two");

  const timeOffersProduct = product({ offers: [offer({ id: "inactive", active: false }), offer({ id: "future", startsAt: "2026-07-19T12:00:00.000Z" }), offer({ id: "expired", endsAt: "2026-07-18T12:00:00.000Z" })] });
  const timeOffers = evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: timeOffersProduct }));
  add("inactive future and expired offers remain excluded", timeOffers.eligibleOffers.length === 0);
  const productMismatch = evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: twoOfferProduct, sellerId: "another-seller" }));
  add("product mismatch returns typed failure", hasFailure(productMismatch, "PRODUCT_MISMATCH"));

  const invalidCart = cart({ items: [item({ id: "duplicate-a" }), item({ id: "duplicate-b" })] });
  const invalid = evaluateCartCommercialState(commercialInput({ currentCart: invalidCart, currentProduct: twoOfferProduct }));
  add("invalid cart returns integrity failure without unsafe quote", !invalid.cartValid && hasFailure(invalid, "INVALID_CART") && !invalid.standardPricing);
  const currentDraft = createCartItem({ id: "draft", productId: "commercial-product", status: "DRAFT" });
  const incomplete = evaluateCartCommercialState(commercialInput({ currentCart: cart({ items: [item()], currentItemDraft: currentDraft, selectedOfferId: "offer-two", status: "COLLECTING_ITEM" }), currentProduct: twoOfferProduct }));
  add("current item draft prevents final offer quote", incomplete.selectedOffer?.eligible === false && hasFailure(incomplete, "INCOMPLETE_CURRENT_ITEM"));
  add("option-less product reprices correctly", two.standardPricing?.merchandiseTotal === 398 && two.eligibleOffers.length === 1 && Object.keys(mergedTwoCart.items[0].selectedOptions).length === 0);

  add("commercial evaluation does not mutate cart", (() => { const source = cart({ items: [item({ selectedOptions: { size: "40" } })] }); const before = JSON.stringify(source); evaluateCartCommercialState(commercialInput({ currentCart: source, currentProduct: twoOfferProduct })); return JSON.stringify(source) === before; })());
  add("commercial evaluation does not mutate product offers", (() => { const source = product({ offers: [offer({ label: " عرض " })] }); const before = JSON.stringify(source); evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: source })); return JSON.stringify(source) === before; })());
  add("same cart and time evaluate deterministically", (() => { const first = evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: twoOfferProduct })); const second = evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: twoOfferProduct })); return JSON.stringify(first) === JSON.stringify(second); })());
  const datedProduct = product({ offers: [offer({ startsAt: "2026-07-18T13:00:00.000Z" })] });
  const beforeStart = evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: datedProduct, now: NOW }));
  const afterStart = evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: datedProduct, now: new Date("2026-07-18T13:00:00.000Z") }));
  add("different explicit time re-evaluates date eligibility", beforeStart.eligibleOffers.length === 0 && afterStart.eligibleOffers.length === 1);
  add("commercial result is immutable and detached", Boolean(two.standardPricing) && Object.isFrozen(two) && Object.isFrozen(two.eligibleOffers) && Object.isFrozen(two.standardPricing) && !Object.is(two.standardPricing, twoOfferProduct));

  const gained = compareCommercialEvaluations(one, two);
  const lost = compareCommercialEvaluations(two, one);
  const selectedLost = compareCommercialEvaluations(restored, selectedBlocked);
  const unchanged = compareCommercialEvaluations(two, evaluateCartCommercialState(commercialInput({ currentCart: mergedTwoCart, currentProduct: twoOfferProduct })));
  add("comparison reports offer gained", gained.state === "OFFER_GAINED_AFTER_CART_CHANGE" && gained.offerGained);
  add("comparison reports offer lost", lost.state === "OFFER_LOST_AFTER_CART_CHANGE" && lost.offerLost);
  add("comparison reports selected offer became ineligible", selectedLost.state === "SELECTED_OFFER_BECAME_INELIGIBLE" && selectedLost.selectedOfferBecameIneligible);
  add("comparison reports no meaningful change", unchanged.state === "NO_MEANINGFUL_CHANGE" && !unchanged.meaningfulChange);

  const moduleSource = ["cart-commercial-evaluation.types.ts", "cart-commercial-evaluation.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "commercial", file), "utf8"))
    .join("\n");
  add("commercial module has no AI messaging renderer receipt Valkey DB or controller dependency", !/(?:\/ai\/|ollama|seller-brain|whatsapp|renderer|receipt|valkey|redis|database|prisma|typeorm|controller)/i.test(moduleSource));

  const passed = results.filter((result) => result.passed).length;
  return { summary: { total: results.length, passed, failed: results.length - passed, passedAll: passed === results.length }, results };
}

