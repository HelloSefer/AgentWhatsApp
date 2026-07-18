import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../../config/offers/offer-config.service";
import type { ProductOfferConfig } from "../../../config/offers/offer.types";
import type { ProductContext } from "../../../config/product-context.types";
import { createCartItem, initializeCart } from "../../cart-state.service";
import type { CartDraft } from "../../cart-state.types";
import { evaluateCartPlanningActions } from "../actions/cart-planning-action-eval.service";
import { evaluateCartPlanning } from "../cart-planning-eval.service";
import { evaluateCartPlanningPresentation } from "../presentation/cart-planning-presentation-eval.service";
import { runCartPlanningPreview } from "./cart-planning-preview.service";
import type { CartPlanningPreviewInput } from "./cart-planning-preview.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type CartPlanningPreviewEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "preview-seller";
const productId = "preview-product";
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
    priority: 10,
    ...input,
  };
}

function product(input: Partial<ProductContext> = {}): ProductContext {
  return {
    sellerId,
    productId,
    name: "Preview Product",
    price: 199,
    currency: "MAD",
    active: true,
    images: [],
    benefits: [],
    optionGroups: [],
    infoMenu: [],
    stock: { enabled: false, status: "AVAILABLE" },
    offers: [offer()],
    ...input,
  };
}

function input(overrides: Partial<CartPlanningPreviewInput> = {}): CartPlanningPreviewInput {
  const currentProduct = overrides.productContext || product();
  const lookup = overrides.offerLookup || new OfferConfigService().getConfiguredOffers({
    sellerId: currentProduct.sellerId,
    productId: currentProduct.productId,
    productContexts: [currentProduct],
  });

  return {
    previewEnabled: true,
    rawActionId: "first_entry:order_now",
    sellerId: currentProduct.sellerId,
    productContext: currentProduct,
    offerLookup: lookup,
    now,
    ...overrides,
  };
}

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

/** Permanent pure regression suite for the opt-in C2C preview boundary. */
export function evaluateCartPlanningPreview(): CartPlanningPreviewEvaluationResult {
  const cases: EvaluationCase[] = [];

  const disabledCart = initializeCart();
  const disabled = runCartPlanningPreview(input({ previewEnabled: false, cart: disabledCart }));
  add(cases, "preview mode disabled keeps current behavior unchanged", !disabled.handled && disabled.route === "NOT_HANDLED" && JSON.stringify(disabled.cartBefore) === JSON.stringify(disabledCart));

  const noOffers = runCartPlanningPreview(input({ productContext: product({ offers: [] }) }));
  add(cases, "Order Now with no configured offers returns quantity selector", noOffers.handled && noOffers.route === "QUANTITY_SELECTOR" && noOffers.nextStep === "SELECT_QUANTITY");
  const inactive = runCartPlanningPreview(input({ productContext: product({ offers: [offer({ active: false })] }) }));
  add(cases, "inactive-only offers return quantity selector", inactive.route === "QUANTITY_SELECTOR");
  const future = runCartPlanningPreview(input({ productContext: product({ offers: [offer({ startsAt: "2027-01-01T00:00:00.000Z" })] }) }));
  const expired = runCartPlanningPreview(input({ productContext: product({ offers: [offer({ endsAt: "2025-01-01T00:00:00.000Z" })] }) }));
  add(cases, "future-only offers return quantity selector", future.route === "QUANTITY_SELECTOR");
  add(cases, "expired-only offers return quantity selector", expired.route === "QUANTITY_SELECTOR");

  const one = runCartPlanningPreview(input());
  add(cases, "one selectable offer returns buttons", one.route === "OFFER_SELECTOR" && one.selector?.kind === "OFFER_BUTTONS");
  const fourProduct = product({
    offers: [
      offer({ id: "offer_1", requiredItemCount: 1, priority: 1 }),
      offer({ id: "offer_2", requiredItemCount: 2, priority: 2 }),
      offer({ id: "offer_3", requiredItemCount: 3, priority: 3 }),
      offer({ id: "offer_4", requiredItemCount: 4, priority: 4 }),
    ],
  });
  const four = runCartPlanningPreview(input({ productContext: fourProduct }));
  add(cases, "four selectable offers return a list", four.route === "OFFER_SELECTOR" && four.selector?.kind === "OFFER_LIST");
  add(cases, "offer ordering matches B1 priority", four.selector?.uiHints?.options?.map((option) => option.id).join(",") === "cart_offer:offer_1,cart_offer:offer_2,cart_offer:offer_3,cart_offer:offer_4");

  const invalidProduct = product({ offers: [offer({ totalPrice: 0 })] });
  const invalid = runCartPlanningPreview(input({ productContext: invalidProduct }));
  add(cases, "invalid offers are never displayed", invalid.route === "QUANTITY_SELECTOR" && invalid.selector?.optionCount === 3 && invalid.failureCode === "INVALID_OFFER_CONFIG");
  const sellerMismatch = runCartPlanningPreview(input({ sellerId: "different-seller" }));
  add(cases, "seller and product isolation is preserved", sellerMismatch.route === "UNAVAILABLE" && sellerMismatch.failureCode === "PRODUCT_MISMATCH");

  for (const rawActionId of ["first_entry:more_info", "confirm:yes", "info:price", "size:38", "color:black", "normal text"]) {
    const output = runCartPlanningPreview(input({ rawActionId }));
    add(cases, `${rawActionId} is not consumed`, !output.handled && output.route === "NOT_HANDLED");
  }

  const offerAction = runCartPlanningPreview(input({ rawActionId: "cart_offer:offer_2" }));
  add(cases, "valid offer action runs C2B and C1", offerAction.route === "PLANNING_ACTION" && offerAction.planningResult?.success === true);
  add(cases, "offer selection derives trusted target count", offerAction.cartAfter.targetItemCount === 2 && offerAction.cartAfter.selectedOfferId === "offer_2");
  const requestWithOfferText = runCartPlanningPreview(input({ rawActionId: "cart_offer:offer_2", productContext: product({ offers: [offer({ totalPrice: 999, label: "Server price" })] }) }));
  add(cases, "offer price and label from request are ignored", requestWithOfferText.cartAfter.targetItemCount === 2 && requestWithOfferText.cartAfter.selectedOfferId === "offer_2");

  const quantity = runCartPlanningPreview(input({ rawActionId: "cart_quantity:3", cart: offerAction.cartAfter }));
  add(cases, "valid quantity action sets standard planning", quantity.planningResult?.success === true && quantity.cartAfter.mode === "STANDARD" && quantity.cartAfter.targetItemCount === 3);
  add(cases, "quantity selection clears selected offer through C1", !quantity.cartAfter.selectedOfferId);
  const moreCart = initializeCart();
  const moreBefore = JSON.stringify(moreCart);
  const more = runCartPlanningPreview(input({ rawActionId: "cart_quantity:more", cart: moreCart }));
  add(cases, "more requests custom quantity without mutation", more.route === "REQUEST_CUSTOM_QUANTITY" && more.nextStep === "REQUEST_CUSTOM_QUANTITY" && JSON.stringify(moreCart) === moreBefore);
  const malformed = runCartPlanningPreview(input({ rawActionId: "cart_quantity:0" }));
  add(cases, "unknown or malformed planning action is rejected safely", malformed.handled && malformed.route === "PLANNING_ACTION" && malformed.failureCode === "INVALID_QUANTITY");
  const repeated = runCartPlanningPreview(input({ rawActionId: "cart_offer:offer_2", cart: offerAction.cartAfter }));
  add(cases, "same action retry remains idempotent", repeated.planningResult?.success === true && repeated.planningResult.changed === false);

  for (const status of ["CONFIRMED", "CART_REVIEW", "COLLECTING_DELIVERY"] as const) {
    const cart = initializeCart();
    cart.status = status;
    const output = runCartPlanningPreview(input({ rawActionId: "cart_quantity:2", cart }));
    const expected = status === "CONFIRMED" ? "CART_ALREADY_CONFIRMED" : "INVALID_CART_STATE";
    add(cases, `${status} lifecycle failure propagates`, output.planningResult?.failureCode === expected);
  }
  const itemCart = initializeCart();
  itemCart.status = "CART_REVIEW";
  itemCart.items = [createCartItem({ productId, selectedOptions: { color: "black" }, status: "COMPLETE" })];
  const itemOutput = runCartPlanningPreview(input({ rawActionId: "cart_offer:offer_2", cart: itemCart }));
  add(cases, "existing items are not silently erased", itemOutput.planningResult?.failureCode === "EXISTING_ITEMS_REQUIRE_RESET" && itemOutput.cartAfter.items.length === 1);
  add(cases, "successful planning returns start item collection metadata", offerAction.nextStep === "START_ITEM_COLLECTION" && quantity.nextStep === "START_ITEM_COLLECTION");
  add(cases, "no cart items are created", offerAction.cartAfter.items.length === 0 && quantity.cartAfter.items.length === 0);
  add(cases, "no current item draft is created", !offerAction.cartAfter.currentItemDraft && !quantity.cartAfter.currentItemDraft);
  add(cases, "no pricing is calculated or stored", !("pricing" in offerAction.cartAfter) && !("totalPrice" in offerAction.cartAfter));

  const mutableInputCart = initializeCart();
  const mutableBefore = JSON.stringify(mutableInputCart);
  const noMutation = runCartPlanningPreview(input({ rawActionId: "cart_quantity:2", cart: mutableInputCart }));
  add(cases, "input preview state is not mutated", JSON.stringify(mutableInputCart) === mutableBefore && noMutation.cartAfter !== mutableInputCart);
  add(cases, "preview state is never persisted", noMutation.cartAfter !== mutableInputCart && noMutation.cartBefore !== mutableInputCart);

  const c1 = evaluateCartPlanning();
  const c2a = evaluateCartPlanningPresentation();
  const c2b = evaluateCartPlanningActions();
  add(cases, "existing C1 C2A and C2B regressions remain passing", c1.failed === 0 && c2a.failed === 0 && c2b.failed === 0);

  const moduleSource = ["cart-planning-preview.types.ts", "cart-planning-preview.service.ts"]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "planning", "preview", file), "utf8"))
    .join("\n");
  add(cases, "preview has no AI dependency", !/from\s+["'][^"']*(?:ollama|openai|ai\/)/i.test(moduleSource));
  add(cases, "preview has no Cloud or Meta transport dependency", !/from\s+["'][^"']*(?:whatsapp|cloud|meta)/i.test(moduleSource));
  add(cases, "preview has no session persistence dependency", !/from\s+["'][^"']*(?:session|valkey|redis|database|prisma|typeorm)/i.test(moduleSource));

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
