import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCartItem, removeItem, updateItem } from "../cart-state.service";
import type { CartDraft, CartItem } from "../cart-state.types";
import type { ProductContext } from "../../config/product-context.types";
import type { ProductOfferConfig } from "../../config/offers/offer.types";
import {
  calculateSelectedOfferPricing,
  calculateStandardCartPricing,
  evaluateAllEligibleOffers,
} from "./cart-pricing.service";

type EvaluationResult = { name: string; passed: boolean; details?: string };

const NOW = new Date("2026-07-18T12:00:00.000Z");

function offer(input: Partial<ProductOfferConfig> = {}): ProductOfferConfig {
  return {
    id: "offer-two",
    productId: "pricing-product",
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
    sellerId: "pricing-seller",
    productId: "pricing-product",
    name: "منتج تسعير",
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
    id: "item-1",
    productId: "pricing-product",
    quantity: 1,
    selectedOptions: {},
    status: "COMPLETE",
    ...input,
  });
}

function cart(items: CartItem[] = [], currentItemDraft?: CartItem): CartDraft {
  return {
    schemaVersion: 1,
    mode: "STANDARD",
    status: items.length ? "CART_REVIEW" : "EMPTY",
    items,
    ...(currentItemDraft ? { currentItemDraft } : {}),
    orderLevelFields: {},
  };
}

function pricingInput(input: {
  currentCart: CartDraft;
  currentProduct?: ProductContext;
  now?: Date;
}) {
  return {
    sellerId: "pricing-seller",
    productContext: input.currentProduct || product(),
    cart: input.currentCart,
    now: input.now || NOW,
  };
}

function hasFailure(result: { failures: Array<{ code: string }> }, code: string): boolean {
  return result.failures.some((entry) => entry.code === code);
}

/** Permanent B2 coverage. It exercises pricing only, never runtime messaging. */
export function evaluateCartPricing(): {
  summary: { total: number; passed: number; failed: number; passedAll: boolean };
  results: EvaluationResult[];
} {
  const results: EvaluationResult[] = [];
  const add = (name: string, passed: boolean, details?: string) => results.push({ name, passed, details });
  const one = cart([item()]);
  const mergedTwo = cart([item({ quantity: 2 })]);
  const variantsTwo = cart([
    item({ id: "item-red", selectedOptions: { color: "أحمر", size: "40" } }),
    item({ id: "item-yellow", selectedOptions: { color: "أصفر", size: "42" } }),
  ]);

  const empty = calculateStandardCartPricing(pricingInput({ currentCart: cart() }));
  const standardOne = calculateStandardCartPricing(pricingInput({ currentCart: one }));
  const standardMergedTwo = calculateStandardCartPricing(pricingInput({ currentCart: mergedTwo }));
  const standardVariantsTwo = calculateStandardCartPricing(pricingInput({ currentCart: variantsTwo }));
  add("empty cart returns typed failure", !empty.ok && hasFailure(empty, "EMPTY_CART"));
  add("one item uses trusted standard price", standardOne.ok && standardOne.quote?.merchandiseTotal === 199 && standardOne.quote.totalUnits === 1);
  add("merged quantity counts as two units", standardMergedTwo.ok && standardMergedTwo.quote?.totalUnits === 2);
  add("two variants count as two units", standardVariantsTwo.ok && standardVariantsTwo.quote?.totalUnits === 2);
  add("standard line totals and subtotal are correct", standardMergedTwo.quote?.lines[0]?.standardLineTotal === 398 && standardMergedTwo.quote.standardSubtotal === 398);

  const oneOfferProduct = product({ offers: [offer({ id: "offer-one", requiredItemCount: 1, totalPrice: 179 })] });
  const oneOffer = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: one, currentProduct: oneOfferProduct }), offerId: "offer-one" });
  const mergedOfferProduct = product({ offers: [offer()] });
  const mergedOffer = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: mergedOfferProduct }), offerId: "offer-two" });
  const mixedOfferProduct = product({ offers: [offer({ allowMixedOptions: true })] });
  const mixedOffer = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: variantsTwo, currentProduct: mixedOfferProduct }), offerId: "offer-two" });
  add("valid one-item offer is eligible", oneOffer.offerEligibility.eligible && oneOffer.quote?.merchandiseTotal === 179);
  add("two-item offer accepts merged quantity", mergedOffer.offerEligibility.eligible && mergedOffer.quote?.totalUnits === 2);
  add("two-item offer accepts two lines when mixed options allowed", mixedOffer.offerEligibility.eligible && mixedOffer.quote?.totalUnits === 2);
  add("two-item offer rejects one unit", !calculateSelectedOfferPricing({ ...pricingInput({ currentCart: one, currentProduct: mergedOfferProduct }), offerId: "offer-two" }).offerEligibility.eligible);
  add("two-item offer rejects three units", hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: cart([item({ quantity: 3 })]), currentProduct: mergedOfferProduct }), offerId: "offer-two" }).offerEligibility, "ITEM_COUNT_MISMATCH"));
  add("inactive offer is ineligible", hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers: [offer({ active: false })] }) }), offerId: "offer-two" }).offerEligibility, "OFFER_INACTIVE"));
  add("future offer is not started", hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers: [offer({ startsAt: "2026-07-19T12:00:00.000Z" })] }) }), offerId: "offer-two" }).offerEligibility, "OFFER_NOT_STARTED"));
  add("past offer is expired", hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers: [offer({ endsAt: "2026-07-18T12:00:00.000Z" })] }) }), offerId: "offer-two" }).offerEligibility, "OFFER_EXPIRED"));
  add("date boundary uses injected clock", calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers: [offer({ startsAt: NOW.toISOString() })] }), now: NOW }), offerId: "offer-two" }).offerEligibility.eligible);
  const matchingOptionsCart = cart([
    item({ id: "same-merged", quantity: 2, selectedOptions: { size: "40", color: "أحمر" } }),
  ]);
  add("mixed-option false accepts matching canonical options", calculateSelectedOfferPricing({ ...pricingInput({ currentCart: matchingOptionsCart, currentProduct: mergedOfferProduct }), offerId: "offer-two" }).offerEligibility.eligible);
  add("mixed-option false rejects different color", hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: variantsTwo, currentProduct: mergedOfferProduct }), offerId: "offer-two" }).offerEligibility, "MIXED_OPTIONS_NOT_ALLOWED"));
  const differentMaterialCart = cart([
    item({ id: "material-a", selectedOptions: { material: "linen" } }),
    item({ id: "material-b", selectedOptions: { material: "cotton" } }),
  ]);
  add("mixed-option false rejects different custom option", hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: differentMaterialCart, currentProduct: mergedOfferProduct }), offerId: "offer-two" }).offerEligibility, "MIXED_OPTIONS_NOT_ALLOWED"));
  add("option-less items remain eligible", mergedOffer.offerEligibility.eligible && Object.keys(mergedTwo.items[0].selectedOptions).length === 0);
  add("product mismatch is rejected", hasFailure(calculateStandardCartPricing(pricingInput({ currentCart: cart([item({ productId: "another-product" })]) })), "PRODUCT_MISMATCH"));
  add("currency mismatch is rejected", hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers: [offer({ currency: "USD" })] }) }), offerId: "offer-two" }).offerEligibility, "INVALID_OFFER_CONFIG"));
  add("invalid offer config is not priced", !calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers: [offer({ totalPrice: 349.999 })] }) }), offerId: "offer-two" }).quote);
  const unknown = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: mergedOfferProduct }), offerId: "unknown" });
  add("unknown selected offer returns typed failure", hasFailure(unknown.offerEligibility, "OFFER_NOT_FOUND"));
  add("standard pricing remains available when offer is ineligible", Boolean(unknown.standardPricing.quote) && !unknown.quote);
  add("offer total discount and merchandise total are correct", mergedOffer.quote?.offerTotal === 349 && mergedOffer.quote.discountAmount === 49 && mergedOffer.quote.merchandiseTotal === 349);
  add("offer above standard subtotal is safely rejected", hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers: [offer({ totalPrice: 499 })] }) }), offerId: "offer-two" }).offerEligibility, "OFFER_TOTAL_EXCEEDS_STANDARD_SUBTOTAL"));
  add("pricing does not mutate cart", (() => { const source = cart([item({ selectedOptions: { size: "40" } })]); const before = JSON.stringify(source); calculateStandardCartPricing(pricingInput({ currentCart: source })); return JSON.stringify(source) === before; })());
  add("pricing does not mutate product offers", (() => { const source = product({ offers: [offer({ label: " عرض " })] }); const before = JSON.stringify(source); calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: source }), offerId: "offer-two" }); return JSON.stringify(source) === before; })());
  add("recalculation after item removal changes eligibility", (() => { const removed = removeItem({ cart: variantsTwo, itemId: "item-yellow" }).cart; return hasFailure(calculateSelectedOfferPricing({ ...pricingInput({ currentCart: removed, currentProduct: mixedOfferProduct }), offerId: "offer-two" }).offerEligibility, "ITEM_COUNT_MISMATCH"); })());
  add("recalculation after item addition can create eligibility", (() => { const initial = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: one, currentProduct: mergedOfferProduct }), offerId: "offer-two" }); const added = cart([item({ id: "merged-after-add", quantity: 2 })]); const next = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: added, currentProduct: mergedOfferProduct }), offerId: "offer-two" }); return !initial.offerEligibility.eligible && next.offerEligibility.eligible; })());
  add("recalculation after option edit rechecks mixed policy", (() => {
    const source = cart([
      item({ id: "edit-a", selectedOptions: { color: "أحمر" } }),
      item({ id: "edit-b", selectedOptions: { color: "أسود" } }),
    ]);
    const before = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: source, currentProduct: mergedOfferProduct }), offerId: "offer-two" });
    const edited = updateItem({ cart: source, itemId: "edit-b", selectedOptions: { color: "أصفر" } }).cart;
    const after = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: edited, currentProduct: mergedOfferProduct }), offerId: "offer-two" });
    return hasFailure(before.offerEligibility, "MIXED_OPTIONS_NOT_ALLOWED") && hasFailure(after.offerEligibility, "MIXED_OPTIONS_NOT_ALLOWED");
  })());
  add("recommended offer ordering is deterministic", (() => { const offers = [offer({ id: "offer-z", priority: 2 }), offer({ id: "offer-a", priority: 1 }), offer({ id: "offer-b", priority: 1 })]; const result = evaluateAllEligibleOffers(pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers }) })); return result.recommendedOffer?.offer.id === "offer-a"; })());
  add("explicitly selected offer is never silently replaced", (() => { const offers = [offer({ id: "offer-one", requiredItemCount: 1, totalPrice: 179, priority: 1 }), offer({ id: "offer-two", priority: 2 })]; const result = calculateSelectedOfferPricing({ ...pricingInput({ currentCart: mergedTwo, currentProduct: product({ offers }) }), offerId: "offer-one" }); return !result.quote && hasFailure(result.offerEligibility, "ITEM_COUNT_MISMATCH"); })());
  add("snapshot is a deep immutable copy", (() => {
    const quote = mergedOffer.quote;
    if (!quote) {
      return false;
    }
    return Object.isFrozen(quote) && Object.isFrozen(quote.lines) && Object.isFrozen(quote.lines[0]) && !Object.is(quote.lines[0], mergedTwo.items[0]);
  })());
  add("minor-unit arithmetic is deterministic", calculateStandardCartPricing(pricingInput({ currentCart: cart([item({ quantity: 3 })]), currentProduct: product({ price: 19.99 }) })).quote?.standardSubtotal === 59.97);

  const pricingModuleSource = ["cart-pricing.types.ts", "offer-eligibility.service.ts", "cart-pricing.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "pricing", file), "utf8"))
    .join("\n");
  add("pricing module has no AI dependency", !/(?:\/ai\/|ollama|generateAIReply|analyzeAIIntent|seller-brain)/i.test(pricingModuleSource));
  add("pricing module has no WhatsApp renderer receipt Valkey or database dependency", !/(?:whatsapp|renderer|receipt|valkey|redis|database|prisma|typeorm)/i.test(pricingModuleSource));
  add("existing B1 no-offer product remains compatible", evaluateAllEligibleOffers(pricingInput({ currentCart: one, currentProduct: product() })).eligibleOffers.length === 0);

  const passed = results.filter((result) => result.passed).length;
  return { summary: { total: results.length, passed, failed: results.length - passed, passedAll: passed === results.length }, results };
}
