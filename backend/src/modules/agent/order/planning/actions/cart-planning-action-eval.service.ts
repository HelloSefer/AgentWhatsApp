import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../../config/offers/offer-config.service";
import type { ProductOfferConfig } from "../../../config/offers/offer.types";
import type { ProductContext } from "../../../config/product-context.types";
import { initializeCart, createCartItem } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import { evaluateCartPlanning } from "../cart-planning-eval.service";
import type { CartPlanningContext } from "../cart-planning.types";
import { buildOfferSelectorPresentation } from "../presentation/cart-planning-presentation.service";
import { handleCartPlanningAction } from "./cart-planning-action-handler.service";
import { normalizeCartPlanningAction } from "./cart-planning-action-normalizer.service";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type CartPlanningActionEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "action-seller";
const productId = "action-product";
const now = new Date("2026-07-18T12:00:00.000Z");

function offer(input: Partial<ProductOfferConfig> = {}): ProductOfferConfig {
  return {
    id: "offer_2",
    productId,
    label: "Two items",
    requiredItemCount: 2,
    totalPrice: 349,
    currency: "MAD",
    active: true,
    allowMixedOptions: true,
    ...input,
  };
}

function product(input: Partial<ProductContext> = {}): ProductContext {
  return {
    sellerId,
    productId,
    name: "Action Product",
    price: 199,
    currency: "MAD",
    active: true,
    images: [],
    benefits: [],
    optionGroups: [],
    infoMenu: [],
    stock: { enabled: false, status: "AVAILABLE" },
    offers: [
      offer(),
      offer({ id: "offer_inactive", active: false }),
      offer({ id: "offer_future", startsAt: "2027-01-01T00:00:00.000Z" }),
      offer({ id: "offer_expired", endsAt: "2025-12-31T23:59:59.999Z" }),
    ],
    ...input,
  };
}

function planningContext(cart: CartDraft, currentProduct = product(), overrides: Partial<CartPlanningContext> = {}): CartPlanningContext {
  const lookup = new OfferConfigService().getConfiguredOffers({
    sellerId: currentProduct.sellerId,
    productId: currentProduct.productId,
    productContexts: [currentProduct],
  });

  return {
    sellerId: currentProduct.sellerId,
    productContext: currentProduct,
    cart,
    offerLookup: lookup,
    now,
    ...overrides,
  };
}

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

function normalizeValid(rawId: string) {
  const result = normalizeCartPlanningAction(rawId);
  if (!result.valid || !result.action) {
    throw new Error(`Expected valid planning action for ${rawId}`);
  }

  return result.action;
}

/** Permanent deterministic regression suite for the C2B action boundary. */
export function evaluateCartPlanningActions(): CartPlanningActionEvaluationResult {
  const cases: EvaluationCase[] = [];

  const offerAction = normalizeCartPlanningAction("cart_offer:offer_2");
  add(cases, "cart_offer normalizes to SELECT_OFFER", offerAction.valid && offerAction.action?.type === "SELECT_OFFER");
  add(cases, "offer id is preserved exactly", offerAction.action?.type === "SELECT_OFFER" && offerAction.action.offerId === "offer_2" && offerAction.action.rawId === "cart_offer:offer_2");
  add(cases, "empty offer id is rejected", normalizeCartPlanningAction("cart_offer:").recognized && normalizeCartPlanningAction("cart_offer:").failureCode === "EMPTY_OFFER_ID");
  add(cases, "malformed offer namespace is not consumed", !normalizeCartPlanningAction("cart_offers:offer_2").recognized && normalizeCartPlanningAction("cart_offers:offer_2").failureCode === "NOT_PLANNING_ACTION");
  add(cases, "offer action with extra price segment is rejected", normalizeCartPlanningAction("cart_offer:offer_2:349").failureCode === "INVALID_OFFER_ID");
  add(cases, "excessively long action id is rejected", normalizeCartPlanningAction(`cart_offer:${"a".repeat(201)}`).failureCode === "ACTION_ID_TOO_LONG");

  for (const quantity of [1, 2, 3]) {
    const normalized = normalizeCartPlanningAction(`cart_quantity:${quantity}`);
    add(cases, `cart_quantity:${quantity} normalizes correctly`, normalized.valid && normalized.action?.type === "SELECT_STANDARD_QUANTITY" && normalized.action.quantity === quantity);
  }
  const more = normalizeCartPlanningAction("cart_quantity:more");
  add(cases, "cart_quantity:more normalizes to request more quantity", more.valid && more.action?.type === "REQUEST_MORE_QUANTITY");
  add(cases, "quantity zero is rejected", normalizeCartPlanningAction("cart_quantity:0").failureCode === "INVALID_QUANTITY");
  add(cases, "negative quantity is rejected", normalizeCartPlanningAction("cart_quantity:-2").failureCode === "INVALID_QUANTITY");
  add(cases, "decimal quantity is rejected", normalizeCartPlanningAction("cart_quantity:2.5").failureCode === "INVALID_QUANTITY");
  add(cases, "scientific quantity is rejected", normalizeCartPlanningAction("cart_quantity:1e2").failureCode === "INVALID_QUANTITY");
  add(cases, "whitespace quantity is rejected", normalizeCartPlanningAction("cart_quantity: 2").failureCode === "INVALID_QUANTITY");
  add(cases, "arbitrary quantity text is rejected", normalizeCartPlanningAction("cart_quantity:many").failureCode === "UNSUPPORTED_QUANTITY_ACTION");

  for (const id of ["normal text", "confirm:yes", "confirm:edit", "info:price", "info:menu", "size:38", "color:black", "custom:value"]) {
    const normalized = normalizeCartPlanningAction(id);
    add(cases, `${id} is not consumed`, !normalized.recognized && !normalized.valid && normalized.failureCode === "NOT_PLANNING_ACTION");
  }

  const offerHandled = handleCartPlanningAction({
    action: normalizeValid("cart_offer:offer_2"),
    planningContext: planningContext(initializeCart()),
  });
  add(cases, "valid offer action executes C1 selection", offerHandled.handled && offerHandled.planningResult?.success === true && offerHandled.planningResult.cart.mode === "OFFER");
  add(cases, "offer target count comes from trusted config", offerHandled.planningResult?.cart.targetItemCount === 2 && offerHandled.planningResult?.cart.selectedOfferId === "offer_2");

  const unknownOffer = handleCartPlanningAction({ action: normalizeValid("cart_offer:unknown"), planningContext: planningContext(initializeCart()) });
  add(cases, "unknown offer returns C1 failure", unknownOffer.planningResult?.failureCode === "UNKNOWN_OFFER");
  for (const [id, expected] of [["offer_inactive", "OFFER_INACTIVE"], ["offer_future", "OFFER_NOT_STARTED"], ["offer_expired", "OFFER_EXPIRED"]] as const) {
    const result = handleCartPlanningAction({ action: normalizeValid(`cart_offer:${id}`), planningContext: planningContext(initializeCart()) });
    add(cases, `${id} availability failure propagates`, result.planningResult?.failureCode === expected);
  }

  const selectedOfferCart = offerHandled.planningResult!.cart;
  const quantityHandled = handleCartPlanningAction({ action: normalizeValid("cart_quantity:3"), planningContext: planningContext(selectedOfferCart) });
  add(cases, "quantity action executes C1 standard planning", quantityHandled.planningResult?.success === true && quantityHandled.planningResult.cart.targetItemCount === 3);
  add(cases, "quantity action clears selected offer through C1", quantityHandled.planningResult?.cart.mode === "STANDARD" && !quantityHandled.planningResult?.cart.selectedOfferId);

  const moreCart = initializeCart();
  const moreBefore = JSON.stringify(moreCart);
  const moreHandled = handleCartPlanningAction({ action: normalizeValid("cart_quantity:more"), planningContext: planningContext(moreCart) });
  add(cases, "more quantity action does not mutate cart", moreHandled.nextStep === "REQUEST_CUSTOM_QUANTITY" && !moreHandled.planningResult && JSON.stringify(moreCart) === moreBefore);

  const repeatedOffer = handleCartPlanningAction({ action: normalizeValid("cart_offer:offer_2"), planningContext: planningContext(offerHandled.planningResult!.cart) });
  add(cases, "same offer action twice is idempotent", repeatedOffer.planningResult?.success === true && repeatedOffer.planningResult.changed === false);
  const repeatedQuantity = handleCartPlanningAction({ action: normalizeValid("cart_quantity:3"), planningContext: planningContext(quantityHandled.planningResult!.cart) });
  add(cases, "same quantity action twice is idempotent", repeatedQuantity.planningResult?.success === true && repeatedQuantity.planningResult.changed === false);

  for (const status of ["CONFIRMED", "CART_REVIEW", "COLLECTING_DELIVERY"] as const) {
    const cart = initializeCart();
    cart.status = status;
    const result = handleCartPlanningAction({ action: normalizeValid("cart_quantity:2"), planningContext: planningContext(cart) });
    const expected = status === "CONFIRMED" ? "CART_ALREADY_CONFIRMED" : "INVALID_CART_STATE";
    add(cases, `${status} lifecycle failure propagates`, result.planningResult?.failureCode === expected);
  }

  const itemCart = initializeCart();
  itemCart.status = "CART_REVIEW";
  itemCart.items = [createCartItem({ productId, selectedOptions: { color: "black" }, status: "COMPLETE" })];
  const itemResult = handleCartPlanningAction({ action: normalizeValid("cart_offer:offer_2"), planningContext: planningContext(itemCart) });
  add(cases, "existing items are not silently erased", itemResult.planningResult?.failureCode === "EXISTING_ITEMS_REQUIRE_RESET" && itemResult.planningResult.cart.items.length === 1);

  const sourceProduct = product();
  const sourceProductBefore = JSON.stringify(sourceProduct);
  const sourceCart = initializeCart();
  const sourceCartBefore = JSON.stringify(sourceCart);
  handleCartPlanningAction({ action: normalizeValid("cart_offer:offer_2"), planningContext: planningContext(sourceCart, sourceProduct) });
  add(cases, "handler does not mutate offer config", JSON.stringify(sourceProduct) === sourceProductBefore);
  add(cases, "handler does not mutate cart outside C1", JSON.stringify(sourceCart) === sourceCartBefore);

  const mismatch = planningContext(initializeCart(), product(), { sellerId: "different-seller" });
  const mismatchResult = handleCartPlanningAction({ action: normalizeValid("cart_offer:offer_2"), planningContext: mismatch });
  add(cases, "seller and product mismatch remains rejected", mismatchResult.planningResult?.failureCode === "PRODUCT_MISMATCH");
  const sellerTwoProduct = product({ sellerId: "seller-two", productId: "product-two", offers: [offer({ productId: "product-two" })] });
  const sellerOne = handleCartPlanningAction({ action: normalizeValid("cart_offer:offer_2"), planningContext: planningContext(initializeCart()) });
  const sellerTwo = handleCartPlanningAction({ action: normalizeValid("cart_offer:offer_2"), planningContext: planningContext(initializeCart(), sellerTwoProduct) });
  add(cases, "two sellers remain isolated", sellerOne.planningResult?.cart !== sellerTwo.planningResult?.cart && sellerTwo.planningResult?.success === true);
  const conversationOne = handleCartPlanningAction({ action: normalizeValid("cart_quantity:1"), planningContext: planningContext(initializeCart()) });
  const conversationTwo = handleCartPlanningAction({ action: normalizeValid("cart_quantity:2"), planningContext: planningContext(initializeCart()) });
  add(cases, "two conversations remain isolated", conversationOne.planningResult?.cart.targetItemCount === 1 && conversationTwo.planningResult?.cart.targetItemCount === 2 && conversationOne.planningResult?.cart !== conversationTwo.planningResult?.cart);

  const presentation = buildOfferSelectorPresentation({
    sellerId,
    productContext: product({ offers: [offer()] }),
    offerLookup: new OfferConfigService().getConfiguredOffers({ sellerId, productId, productContexts: [product({ offers: [offer()] })] }),
    now,
  });
  const presentationActionId = presentation.uiHints?.options?.[0]?.id;
  add(cases, "C2A presentation action IDs are compatible", presentationActionId === "cart_offer:offer_2" && normalizeCartPlanningAction(presentationActionId).valid);
  const c1Regression = evaluateCartPlanning();
  add(cases, "existing C1 planning regression remains passing", c1Regression.failed === 0);

  const moduleSource = [
    "cart-planning-action.types.ts",
    "cart-planning-action-normalizer.service.ts",
    "cart-planning-action-handler.service.ts",
  ].map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "planning", "actions", file), "utf8")).join("\n");
  add(cases, "action module has no AI, pricing, commercial, renderer, receipt, Cloud, Valkey, or DB dependency", !/from\s+["'][^"']*(?:ollama|openai|pricing|commercial|renderer|receipt|whatsapp|valkey|redis|database|prisma|typeorm)/i.test(moduleSource));

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
