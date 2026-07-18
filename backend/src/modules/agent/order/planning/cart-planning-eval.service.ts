import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../config/offers/offer-config.service";
import type { ProductContext } from "../../config/product-context.types";
import { createCartItem, initializeCart } from "../cart-state.service";
import type { CartDraft } from "../cart-state.types";
import {
  clearPlanning,
  initializeOfferCartPlanning,
  initializeStandardCartPlanning,
  inspectCartPlanningReadiness,
  selectConfiguredOffer,
  selectStandardTargetQuantity,
} from "./cart-planning.service";
import type { CartPlanningContext } from "./cart-planning.types";

type EvaluationCase = {
  name: string;
  passed: boolean;
  detail?: string;
};

export type CartPlanningEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "planning-seller";
const product: ProductContext = {
  sellerId,
  productId: "planning-product",
  name: "Planning Product",
  currency: "MAD",
  price: 100,
  active: true,
  images: [],
  benefits: [],
  optionGroups: [],
  infoMenu: [],
  stock: { enabled: false, status: "AVAILABLE" },
  offers: [
    {
      id: "offer-two",
      productId: "planning-product",
      label: "Two items",
      requiredItemCount: 2,
      totalPrice: 180,
      currency: "MAD",
      active: true,
      allowMixedOptions: true,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-12-31T23:59:59.999Z",
    },
    {
      id: "offer-three",
      productId: "planning-product",
      label: "Three items",
      requiredItemCount: 3,
      totalPrice: 250,
      currency: "MAD",
      active: true,
      allowMixedOptions: true,
    },
    {
      id: "offer-inactive",
      productId: "planning-product",
      label: "Inactive",
      requiredItemCount: 2,
      totalPrice: 180,
      currency: "MAD",
      active: false,
      allowMixedOptions: true,
    },
    {
      id: "offer-future",
      productId: "planning-product",
      label: "Future",
      requiredItemCount: 2,
      totalPrice: 180,
      currency: "MAD",
      active: true,
      allowMixedOptions: true,
      startsAt: "2027-01-01T00:00:00.000Z",
    },
    {
      id: "offer-expired",
      productId: "planning-product",
      label: "Expired",
      requiredItemCount: 2,
      totalPrice: 180,
      currency: "MAD",
      active: true,
      allowMixedOptions: true,
      endsAt: "2025-12-31T23:59:59.999Z",
    },
  ],
};

function context(cart: CartDraft, overrides: Partial<CartPlanningContext> = {}): CartPlanningContext {
  const lookup = new OfferConfigService().getConfiguredOffers({
    sellerId,
    productId: "planning-product",
    productContexts: [product],
  });

  return {
    sellerId,
    productContext: product,
    cart,
    offerLookup: lookup,
    now: new Date("2026-07-18T12:00:00.000Z"),
    ...overrides,
  };
}

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

/** Permanent deterministic regression suite for the cart planning boundary. */
export function evaluateCartPlanning(): CartPlanningEvaluationResult {
  const cases: EvaluationCase[] = [];

  const standard = initializeStandardCartPlanning(context(initializeCart()));
  add(cases, "initializes standard planning", standard.success && standard.cart.mode === "STANDARD" && standard.cart.targetItemCount === 1 && standard.cart.status === "PLANNING");

  const standardTwo = selectStandardTargetQuantity(context(initializeCart()), 2);
  add(cases, "selects standard target quantity", standardTwo.success && standardTwo.cart.targetItemCount === 2);

  const offerCart = { ...initializeCart("OFFER"), status: "PLANNING" as const, targetItemCount: 2, selectedOfferId: "offer-two" };
  const clearsOffer = selectStandardTargetQuantity(context(offerCart), 3);
  add(cases, "standard planning clears selected offer", clearsOffer.success && !clearsOffer.cart.selectedOfferId && clearsOffer.cart.mode === "STANDARD");

  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 101, "2"]) {
    const result = selectStandardTargetQuantity(context(initializeCart()), invalid);
    add(cases, `rejects invalid standard quantity ${String(invalid)}`, !result.success && result.failureCode === "INVALID_QUANTITY");
  }

  const selected = selectConfiguredOffer(context(initializeCart()), "offer-two");
  add(cases, "selects configured offer by stable id", selected.success && selected.cart.mode === "OFFER" && selected.cart.selectedOfferId === "offer-two");
  add(cases, "derives target count from configured offer", selected.cart.targetItemCount === 2);

  const untrustedOfferRequest = { offerId: "offer-two", requiredItemCount: 99, totalPrice: 1, currency: "USD" };
  const untrustedResult = selectConfiguredOffer(context(initializeCart()), untrustedOfferRequest.offerId);
  add(cases, "ignores client commercial values", untrustedResult.success && untrustedResult.cart.targetItemCount === 2);

  const unknown = selectConfiguredOffer(context(initializeCart()), "does-not-exist");
  add(cases, "rejects unknown offer", !unknown.success && unknown.failureCode === "UNKNOWN_OFFER");
  const inactive = selectConfiguredOffer(context(initializeCart()), "offer-inactive");
  add(cases, "rejects inactive offer", !inactive.success && inactive.failureCode === "OFFER_INACTIVE");
  const invalidProduct: ProductContext = {
    ...product,
    offers: [{ ...product.offers![0], requiredItemCount: 0 }],
  };
  const invalidLookup = new OfferConfigService().getConfiguredOffers({
    sellerId,
    productId: "planning-product",
    productContexts: [invalidProduct],
  });
  const invalidConfig = selectConfiguredOffer(context(initializeCart(), { offerLookup: invalidLookup }), "offer-two");
  add(cases, "rejects invalid offer configuration", !invalidConfig.success && invalidConfig.failureCode === "INVALID_OFFER_CONFIG");
  const future = selectConfiguredOffer(context(initializeCart()), "offer-future");
  add(cases, "rejects future offer", !future.success && future.failureCode === "OFFER_NOT_STARTED");
  const expired = selectConfiguredOffer(context(initializeCart()), "offer-expired");
  add(cases, "rejects expired offer", !expired.success && expired.failureCode === "OFFER_EXPIRED");
  const startsAtBoundary = selectConfiguredOffer(context(initializeCart(), { now: new Date("2026-01-01T00:00:00.000Z") }), "offer-two");
  add(cases, "accepts offer at start boundary", startsAtBoundary.success);

  const replaced = selectConfiguredOffer(context(selected.cart), "offer-three");
  add(cases, "replaces offer before collection", replaced.success && replaced.changed && replaced.cart.selectedOfferId === "offer-three" && replaced.cart.targetItemCount === 3);
  const repeatOffer = selectConfiguredOffer(context(replaced.cart), "offer-three");
  add(cases, "repeating same offer is idempotent", repeatOffer.success && !repeatOffer.changed);
  const repeatStandard = selectStandardTargetQuantity(context(standardTwo.cart), 2);
  add(cases, "repeating same standard target is idempotent", repeatStandard.success && !repeatStandard.changed);

  const cartWithItem = initializeCart();
  cartWithItem.status = "CART_REVIEW";
  cartWithItem.items = [createCartItem({ productId: "planning-product", selectedOptions: { color: "black" }, status: "COMPLETE" })];
  const existingItems = initializeOfferCartPlanning(context(cartWithItem), "offer-two");
  add(cases, "existing items require explicit reset", !existingItems.success && existingItems.failureCode === "EXISTING_ITEMS_REQUIRE_RESET");
  add(cases, "planning never erases existing items", existingItems.cart.items.length === 1 && existingItems.cart.items[0].selectedOptions.color === "black");

  const unsafeDraft = initializeCart();
  unsafeDraft.status = "COLLECTING_ITEM";
  unsafeDraft.currentItemDraft = createCartItem({ productId: "planning-product", selectedOptions: { size: "38" } });
  const unresolved = selectStandardTargetQuantity(context(unsafeDraft), 2);
  add(cases, "blocks unresolved current item", !unresolved.success && unresolved.failureCode === "UNRESOLVED_CURRENT_ITEM");

  const pristineDraft = initializeCart();
  pristineDraft.status = "COLLECTING_ITEM";
  pristineDraft.currentItemDraft = createCartItem({ productId: "planning-product" });
  const pristineAllowed = selectStandardTargetQuantity(context(pristineDraft), 2);
  add(cases, "allows pristine current item draft", pristineAllowed.success);
  add(cases, "planning does not mutate selected options", Object.keys(pristineDraft.currentItemDraft!.selectedOptions).length === 0 && !pristineDraft.currentItemDraft!.quantityExplicitlySet);
  add(cases, "planning does not add items", pristineAllowed.cart.items.length === 0 && pristineDraft.items.length === 0);

  for (const status of ["AWAITING_CONFIRMATION", "CONFIRMED", "CANCELLED", "COLLECTING_DELIVERY"] as const) {
    const cart = initializeCart();
    cart.status = status;
    const result = selectStandardTargetQuantity(context(cart), 2);
    const expected = status === "CONFIRMED" ? "CART_ALREADY_CONFIRMED" : "INVALID_CART_STATE";
    add(cases, `blocks ${status} planning state`, !result.success && result.failureCode === expected);
  }

  const cleared = clearPlanning(context(selected.cart));
  add(cases, "clears plan without removing cart data", cleared.success && cleared.cart.mode === "STANDARD" && !cleared.cart.targetItemCount && !cleared.cart.selectedOfferId);
  const clearEmpty = clearPlanning(context(initializeCart()));
  add(cases, "clearing empty planning is idempotent", clearEmpty.success && !clearEmpty.changed && clearEmpty.cart.status === "EMPTY");
  const readiness = inspectCartPlanningReadiness(context(initializeCart()));
  add(cases, "readiness reports safe empty cart", readiness.ready && !readiness.failureCode);

  const mismatch = context(initializeCart(), { sellerId: "other-seller" });
  const productMismatch = selectConfiguredOffer(mismatch, "offer-two");
  add(cases, "rejects seller scoped lookup mismatch", !productMismatch.success && productMismatch.failureCode === "PRODUCT_MISMATCH");
  const invalidTime = selectConfiguredOffer(context(initializeCart(), { now: new Date("invalid") }), "offer-two");
  add(cases, "rejects invalid evaluation time", !invalidTime.success && invalidTime.failureCode === "INVALID_EVALUATION_TIME");

  const conversationOne = selectConfiguredOffer(context(initializeCart()), "offer-two");
  const conversationTwo = selectStandardTargetQuantity(context(initializeCart()), 3);
  add(cases, "keeps independent carts isolated", conversationOne.cart.selectedOfferId === "offer-two" && !conversationTwo.cart.selectedOfferId && conversationTwo.cart.targetItemCount === 3);

  const sellerTwo = "planning-seller-two";
  const sellerTwoProduct: ProductContext = {
    ...product,
    sellerId: sellerTwo,
    productId: "planning-product-two",
    offers: product.offers!.map((offer) => ({ ...offer, productId: "planning-product-two" })),
  };
  const sellerTwoLookup = new OfferConfigService().getConfiguredOffers({
    sellerId: sellerTwo,
    productId: "planning-product-two",
    productContexts: [sellerTwoProduct],
  });
  const sellerTwoResult = selectConfiguredOffer(
    context(initializeCart(), { sellerId: sellerTwo, productContext: sellerTwoProduct, offerLookup: sellerTwoLookup }),
    "offer-two",
  );
  add(cases, "keeps seller planning isolated", sellerTwoResult.success && sellerTwoResult.cart.selectedOfferId === "offer-two" && sellerTwoResult.cart !== conversationOne.cart);

  const productBefore = JSON.stringify(product);
  selectConfiguredOffer(context(initializeCart()), "offer-two");
  add(cases, "planning does not mutate product offer configuration", JSON.stringify(product) === productBefore);

  const source = readFileSync(join(process.cwd(), "src/modules/agent/order/planning/cart-planning.service.ts"), "utf8");
  add(cases, "planning service has no pricing dependency", !/pricing\//i.test(source));
  add(cases, "planning service has no AI, messaging, renderer, or receipt dependency", !/(ollama|openai|whatsapp|sendMessage|renderer|receipt)/i.test(source));

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
