import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OfferConfigService } from "../../../../config/offers/offer-config.service";
import type { ProductContext } from "../../../../config/product-context.types";
import { createCartItem, initializeCart } from "../../../cart-state.service";
import type { CartDraft } from "../../../cart-state.types";
import { evaluateCartPlanningActions } from "../../actions/cart-planning-action-eval.service";
import { evaluateCartPlanning } from "../../cart-planning-eval.service";
import type { CartPlanningContext } from "../../cart-planning.types";
import { evaluateCartPlanningPreview } from "../../preview/cart-planning-preview-eval.service";
import {
  runCartPlanningPreview,
} from "../../preview/cart-planning-preview.service";
import type { CartPlanningPreviewInput } from "../../preview/cart-planning-preview.types";
import { evaluateCartQuantityInput } from "../cart-quantity-input-eval.service";
import {
  beginCartCustomQuantityAwaiting,
  handleCartCustomQuantityInput,
} from "./cart-custom-quantity-flow.service";
import {
  CART_PLANNING_PREVIEW_STATE_VERSION,
  MAX_CUSTOM_QUANTITY_ATTEMPTS,
  type CartPlanningAwaitingInput,
} from "./cart-custom-quantity-flow.types";

type EvaluationCase = { name: string; passed: boolean; detail?: string };

export type CartCustomQuantityFlowEvaluationResult = {
  total: number;
  passed: number;
  failed: number;
  cases: EvaluationCase[];
};

const sellerId = "custom-quantity-flow-seller";
const productId = "custom-quantity-flow-product";
const now = new Date("2026-07-18T12:00:00.000Z");
const productContext: ProductContext = {
  sellerId,
  productId,
  name: "Custom Quantity Flow Product",
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
      id: "offer-two",
      productId,
      label: "Two items",
      requiredItemCount: 2,
      totalPrice: 349,
      currency: "MAD",
      active: true,
      allowMixedOptions: true,
    },
  ],
};

function add(cases: EvaluationCase[], name: string, passed: boolean, detail?: string): void {
  cases.push({ name, passed, detail: passed ? undefined : detail });
}

function planningContext(cart: CartDraft): CartPlanningContext {
  return {
    sellerId,
    productContext,
    cart,
    offerLookup: new OfferConfigService().getConfiguredOffers({
      sellerId,
      productId,
      productContexts: [productContext],
    }),
    now,
  };
}

function previewInput(overrides: Partial<CartPlanningPreviewInput> = {}): CartPlanningPreviewInput {
  const cart = overrides.cart || initializeCart();
  return {
    previewEnabled: true,
    rawActionId: "cart_quantity:more",
    sellerId,
    productContext,
    offerLookup: planningContext(cart).offerLookup,
    cart,
    now,
    ...overrides,
  };
}

function startAwaiting(cart: CartDraft = initializeCart()) {
  return runCartPlanningPreview(previewInput({ cart, rawActionId: "cart_quantity:more" }));
}

function submit(input: {
  cart: CartDraft;
  awaitingInput: CartPlanningAwaitingInput;
  planningText: unknown;
}) {
  return runCartPlanningPreview(previewInput({
    rawActionId: "",
    cart: input.cart,
    previewPlanningState: {
      version: CART_PLANNING_PREVIEW_STATE_VERSION,
      awaitingInput: input.awaitingInput,
    },
    planningText: input.planningText,
  }));
}

/** Permanent pure regression suite for C3B preview-only custom quantity flow. */
export function evaluateCartCustomQuantityFlow(): CartCustomQuantityFlowEvaluationResult {
  const cases: EvaluationCase[] = [];

  const moreInput = initializeCart();
  const moreBefore = JSON.stringify(moreInput);
  const more = startAwaiting(moreInput);
  add(cases, "cart_quantity:more creates explicit custom quantity awaiting state", more.handled && more.route === "REQUEST_CUSTOM_QUANTITY" && more.previewPlanningState.awaitingInput.kind === "CUSTOM_QUANTITY" && more.previewPlanningState.awaitingInput.attempts === 0);
  add(cases, "entering custom quantity awaiting state does not mutate cart", JSON.stringify(moreInput) === moreBefore && JSON.stringify(more.cartAfter) === moreBefore);
  add(cases, "entering custom quantity keeps selected offer unchanged", !more.cartAfter.selectedOfferId && !more.cartAfter.targetItemCount);

  const valid = submit({ cart: more.cartAfter, awaitingInput: more.previewPlanningState.awaitingInput, planningText: "5" });
  add(cases, 'valid "5" selects a trusted target quantity', valid.planningResult?.success === true && valid.cartAfter.targetItemCount === 5);
  add(cases, "valid input routes through C1 standard quantity command", valid.planningResult?.command === "SELECT_STANDARD_QUANTITY");
  add(cases, "successful selection uses STANDARD mode and clears awaiting state", valid.cartAfter.mode === "STANDARD" && valid.previewPlanningState.awaitingInput.kind === "NONE");
  add(cases, "successful selection returns START_ITEM_COLLECTION", valid.nextStep === "START_ITEM_COLLECTION" && valid.route === "PLANNING_ACTION");
  add(cases, "successful selection does not create items or a draft", valid.cartAfter.items.length === 0 && !valid.cartAfter.currentItemDraft);

  const darijaStart = startAwaiting();
  const darija = submit({ cart: darijaStart.cartAfter, awaitingInput: darijaStart.previewPlanningState.awaitingInput, planningText: "بغيت 5" });
  add(cases, 'Darija "بغيت 5" is accepted only while awaiting', darija.quantityResult?.success === true && darija.cartAfter.targetItemCount === 5);
  const indicStart = startAwaiting();
  const indic = submit({ cart: indicStart.cartAfter, awaitingInput: indicStart.previewPlanningState.awaitingInput, planningText: "٤" });
  add(cases, "Arabic-Indic digits are accepted while awaiting", indic.quantityResult?.success === true && indic.cartAfter.targetItemCount === 4);
  const wordStart = startAwaiting();
  const word = submit({ cart: wordStart.cartAfter, awaitingInput: wordStart.previewPlanningState.awaitingInput, planningText: "جوج" });
  add(cases, "supported quantity words are accepted while awaiting", word.quantityResult?.success === true && word.cartAfter.targetItemCount === 2);

  const offered = initializeCart("OFFER");
  offered.status = "PLANNING";
  offered.targetItemCount = 2;
  offered.selectedOfferId = "offer-two";
  const offerAwaiting = startAwaiting(offered);
  const standardAfterOffer = submit({ cart: offerAwaiting.cartAfter, awaitingInput: offerAwaiting.previewPlanningState.awaitingInput, planningText: "3" });
  add(cases, "C1 clears selected offer on custom standard quantity", standardAfterOffer.cartAfter.mode === "STANDARD" && !standardAfterOffer.cartAfter.selectedOfferId && standardAfterOffer.cartAfter.targetItemCount === 3);

  const invalidCart = initializeCart();
  const invalidStart = startAwaiting(invalidCart);
  const invalid = submit({ cart: invalidStart.cartAfter, awaitingInput: invalidStart.previewPlanningState.awaitingInput, planningText: "4 و 5" });
  add(cases, "ambiguous input preserves cart", JSON.stringify(invalid.cartAfter) === JSON.stringify(invalidStart.cartAfter));
  add(cases, "invalid input retains awaiting state and increments attempts", invalid.previewPlanningState.awaitingInput.kind === "CUSTOM_QUANTITY" && invalid.previewPlanningState.awaitingInput.attempts === 1 && invalid.nextStep === "RETRY_CUSTOM_QUANTITY");

  for (const [label, text] of [["phone", "0612345678"], ["price", "200 درهم"], ["size", "مقاس 38"], ["excess quantity", "101"]] as const) {
    const started = startAwaiting();
    const output = submit({ cart: started.cartAfter, awaitingInput: started.previewPlanningState.awaitingInput, planningText: text });
    add(cases, `${label}-like input is rejected without cart mutation`, output.quantityResult?.success === false && JSON.stringify(output.cartAfter) === JSON.stringify(started.cartAfter));
  }

  let retry = startAwaiting();
  for (let attempt = 1; attempt <= MAX_CUSTOM_QUANTITY_ATTEMPTS; attempt += 1) {
    retry = submit({ cart: retry.cartAfter, awaitingInput: retry.previewPlanningState.awaitingInput, planningText: "لا أعرف" });
  }
  add(cases, "attempts are bounded and exhaustion clears the preview-only await state", retry.nextStep === "CUSTOM_QUANTITY_EXHAUSTED" && retry.previewPlanningState.awaitingInput.kind === "NONE");
  add(cases, "exhaustion never guesses a quantity or mutates cart", !retry.cartAfter.targetItemCount && retry.cartAfter.mode === "STANDARD");

  const noAwaitingNumber = runCartPlanningPreview(previewInput({ rawActionId: "", planningText: "5" }));
  const noAwaitingDarija = runCartPlanningPreview(previewInput({ rawActionId: "", planningText: "بغيت 5" }));
  const noAwaitingQuestion = runCartPlanningPreview(previewInput({ rawActionId: "", planningText: "شنو الثمن؟" }));
  add(cases, 'text "5" without awaiting state is not handled', !noAwaitingNumber.handled && noAwaitingNumber.route === "NOT_HANDLED");
  add(cases, "Darija quantity phrase without awaiting state is not handled", !noAwaitingDarija.handled);
  add(cases, "normal product question without awaiting state is not handled", !noAwaitingQuestion.handled);

  for (const actionId of ["confirm:yes", "info:price", "size:38", "color:black"] as const) {
    const output = runCartPlanningPreview(previewInput({ rawActionId: actionId }));
    add(cases, `${actionId} remains outside custom quantity handling`, !output.handled && output.route === "NOT_HANDLED");
  }

  for (const status of ["CONFIRMED", "CART_REVIEW", "COLLECTING_DELIVERY", "AWAITING_CONFIRMATION"] as const) {
    const cart = initializeCart();
    cart.status = status;
    const started = startAwaiting(cart);
    const output = submit({ cart: started.cartAfter, awaitingInput: started.previewPlanningState.awaitingInput, planningText: "5" });
    const expected = status === "CONFIRMED" ? "CART_ALREADY_CONFIRMED" : "INVALID_CART_STATE";
    add(cases, `${status} C1 lifecycle failure propagates without clearing awaiting state`, output.planningResult?.failureCode === expected && output.previewPlanningState.awaitingInput.kind === "CUSTOM_QUANTITY");
  }

  const itemCart = initializeCart();
  itemCart.status = "CART_REVIEW";
  itemCart.items = [createCartItem({ productId, selectedOptions: { color: "black" }, status: "COMPLETE" })];
  const itemStarted = startAwaiting(itemCart);
  const itemOutput = submit({ cart: itemStarted.cartAfter, awaitingInput: itemStarted.previewPlanningState.awaitingInput, planningText: "5" });
  add(cases, "existing completed items are never erased", itemOutput.cartAfter.items.length === 1 && itemOutput.planningResult?.failureCode === "EXISTING_ITEMS_REQUIRE_RESET");

  const mutableCart = initializeCart();
  const mutableState = { kind: "CUSTOM_QUANTITY" as const, attempts: 0 };
  const mutableCartBefore = JSON.stringify(mutableCart);
  const mutableStateBefore = JSON.stringify(mutableState);
  const direct = handleCartCustomQuantityInput({ cart: mutableCart, awaitingInput: mutableState, planningText: "5", planningContext: planningContext(mutableCart) });
  add(cases, "input preview cart and awaiting objects are not mutated", JSON.stringify(mutableCart) === mutableCartBefore && JSON.stringify(mutableState) === mutableStateBefore && direct.cartAfter !== mutableCart);
  const replayMore = beginCartCustomQuantityAwaiting({ cart: more.cartAfter, awaitingInput: more.previewPlanningState.awaitingInput });
  add(cases, "replaying cart_quantity:more preserves equivalent awaiting state", replayMore.awaitingInput.kind === "CUSTOM_QUANTITY" && replayMore.awaitingInput.attempts === 0 && JSON.stringify(replayMore.cartAfter) === JSON.stringify(more.cartAfter));
  const idempotent = handleCartCustomQuantityInput({
    cart: valid.cartAfter,
    awaitingInput: { kind: "CUSTOM_QUANTITY", attempts: 0 },
    planningText: "5",
    planningContext: planningContext(valid.cartAfter),
  });
  add(cases, "repeated valid standard quantity follows C1 idempotency", idempotent.planningResult?.success === true && idempotent.planningResult.changed === false);

  const c3a = evaluateCartQuantityInput();
  const c2c = evaluateCartPlanningPreview();
  const c2b = evaluateCartPlanningActions();
  const c1 = evaluateCartPlanning();
  add(cases, "C3A quantity parser regression remains passing", c3a.failed === 0);
  add(cases, "C2C preview regression remains passing", c2c.failed === 0);
  add(cases, "C2B and C1 planning regressions remain passing", c2b.failed === 0 && c1.failed === 0);

  const flowSource = [
    "cart-custom-quantity-flow.types.ts",
    "cart-custom-quantity-flow.service.ts",
  ].map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "planning", "quantity", "flow", file), "utf8")).join("\n");
  add(cases, "flow has no AI or seller-brain dependency", !/from\s+["'][^"']*(?:ollama|openai|ai\/|seller-brain)/i.test(flowSource));
  add(cases, "flow has no persistence, Cloud, receipt, database, or queue dependency", !/from\s+["'][^"']*(?:session|valkey|redis|whatsapp|cloud|receipt|database|prisma|typeorm|bull|queue)/i.test(flowSource));
  add(cases, "flow owns no global mutable state", !/^(?:let|var)\s+/m.test(flowSource));

  const passed = cases.filter((test) => test.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}
