import { conversationKeyService } from "../../identity/conversation-key.service";
import { offerConfigService } from "../../config/offers/offer-config.service";
import { productContextService } from "../../config/product-context.service";
import { requiredFieldsService } from "../../config/required-fields.service";
import { normalizeSellerConfig } from "../../config/first-entry-config.service";
import { sellerConfigService } from "../../config/seller-config.service";
import {
  clearConversationSession,
  getConversationSession,
  updateConversationProductInfoState,
} from "../../session/conversation-session.service";
import { evaluateCartCommercialState } from "../commercial/cart-commercial-evaluation.service";
import { processGuardedOrderRuntimeTurn } from "./order-runtime-router.service";
import type { OrderRuntimeSession, OrderRuntimeTurnResult } from "./order-runtime.types";

type Assertion = { name: string; passed: boolean; detail?: string };

export type TotalPiecePlanningEvaluationReport = {
  phase: "6.3H2-R5";
  total: number;
  passed: number;
  failed: number;
  strictAcceptance: boolean;
  noLiveSend: true;
  assertions: Assertion[];
};

const SELLER_ID = "seller_demo_sandals";
const PRODUCT_ID = "prod_demo_sandal_001";

function add(assertions: Assertion[], name: string, passed: boolean, detail?: string): void {
  assertions.push({ name, passed, ...(passed ? {} : { detail }) });
}

function identity(label: string) {
  const customerPhone = `h2-r5-${label}`;
  return {
    sellerId: SELLER_ID,
    customerPhone,
    conversationKey: conversationKeyService.buildConversationKey(SELLER_ID, customerPhone),
    productId: PRODUCT_ID,
  };
}

async function reset(scope: ReturnType<typeof identity>): Promise<void> {
  await clearConversationSession(scope.conversationKey, scope.sellerId, scope.productId);
}

async function runtime(scope: ReturnType<typeof identity>): Promise<OrderRuntimeSession | undefined> {
  const session = await getConversationSession(
    scope.conversationKey,
    scope.sellerId,
    scope.productId,
    scope.customerPhone,
  );
  return session.orderRuntime as OrderRuntimeSession | undefined;
}

async function turn(
  scope: ReturnType<typeof identity>,
  message: string,
): Promise<OrderRuntimeTurnResult> {
  return processGuardedOrderRuntimeTurn({
    ...scope,
    message,
    actionId: message,
    normalizedText: message,
    activationRequested: true,
  });
}

function hasQuantityPrompt(result: OrderRuntimeTurnResult | undefined): boolean {
  return Boolean(result?.reply?.includes("حدد كمية هاد القطعة"));
}

function itemUnits(runtimeSession: OrderRuntimeSession | undefined): number {
  return runtimeSession?.cart.items.reduce((total, item) => total + item.quantity, 0) || 0;
}

function optionIds(result: OrderRuntimeTurnResult | undefined): string[] {
  return result?.replyUi?.options?.map((option) => option.id) || [];
}

/**
 * Permanent R5 regression for the guarded, local-only initial slot workflow.
 * It invokes no transport or receipt code and always cleans its exact sessions.
 */
export async function evaluateTotalPiecePlanning(): Promise<TotalPiecePlanningEvaluationReport> {
  const assertions: Assertion[] = [];
  const scopes = ["different", "same", "three", "info-size", "info-both", "info-invalid"]
    .map(identity);
  const sellerConfig = normalizeSellerConfig(sellerConfigService.getSellerConfig(SELLER_ID));
  const productContext = productContextService.getActiveProductContext(SELLER_ID);
  const fields = requiredFieldsService.getOrderFields({ sellerConfig, productContext });
  const offers = offerConfigService.getConfiguredOffers({ sellerId: SELLER_ID, productId: productContext.productId });

  const sizeField = fields.find((field) => field.key === "size");
  const colorField = fields.find((field) => field.key === "color");
  const firstSize = sizeField?.options?.includes("39") ? "39" : sizeField?.options?.[0];
  const secondSize = sizeField?.options?.find((value) => value !== firstSize) || firstSize;
  const firstColor = colorField?.options?.includes("وردي") ? "وردي" : colorField?.options?.[0];
  const secondColor = colorField?.options?.find((value) => value !== firstColor) || firstColor;
  const supportsVariantFlow = Boolean(firstSize && secondSize && firstColor && secondColor && firstSize !== secondSize && firstColor !== secondColor);
  add(assertions, "demo configuration has two distinct item variants for total-piece coverage", supportsVariantFlow);

  try {
    const different = identity("different");
    await reset(different);
    const entry = await turn(different, "first_entry:order_now");
    add(assertions, "First Entry enters canonical planning", entry.handled === true && entry.stage === "PLANNING");
    const selectedTwo = await turn(different, "cart_quantity:2");
    let state = await runtime(different);
    add(assertions, "planned count 2 creates fixed two-piece semantics", state?.cart.targetItemCount === 2 && state.cart.initialCollectionMode === "IMPLICIT_PLANNED_PIECE_SLOTS");
    add(assertions, "planned count 2 creates only the first slot draft", state?.cart.items.length === 0 && Boolean(state?.cart.currentItemDraft) && state?.cart.currentItemDraft?.quantity === 1);
    add(assertions, "first transition is friendly and includes the actual first prompt", Boolean(selectedTwo.reply?.includes("غادي نوجد ليك")) && Boolean(selectedTwo.reply?.includes("اختار")));
    add(assertions, "initial planned collection does not ask a per-item quantity", !hasQuantityPrompt(selectedTwo));

    const firstOption = await turn(different, `cart_item_option:size:${firstSize}`);
    add(assertions, "first slot continues through configured options", firstOption.handled === true && !hasQuantityPrompt(firstOption));
    const firstCompleted = await turn(different, `cart_item_option:color:${firstColor}`);
    state = await runtime(different);
    add(assertions, "first slot finalizes automatically with one implicit piece", itemUnits(state) === 1 && state?.cart.items[0]?.quantitySource === "IMPLICIT_PLANNED_SLOT");
    add(assertions, "second slot starts automatically after first completion", state?.runtimeStage === "COLLECTING_ITEM" && Boolean(state?.cart.currentItemDraft));
    add(assertions, "Same/Different remains canonical after the first slot", optionIds(firstCompleted).includes("cart_item_previous:same") && optionIds(firstCompleted).includes("cart_item_previous:different"));
    add(assertions, "first completed slot never asked for quantity", !hasQuantityPrompt(firstCompleted));

    const chooseDifferent = await turn(different, "cart_item_previous:different");
    state = await runtime(different);
    add(assertions, "Different Choices begins an empty second slot", chooseDifferent.handled === true && Object.keys(state?.cart.currentItemDraft?.selectedOptions || {}).length === 0);
    add(assertions, "Different Choices does not ask for quantity", !hasQuantityPrompt(chooseDifferent));
    await turn(different, `cart_item_option:size:${secondSize}`);
    const secondCompleted = await turn(different, `cart_item_option:color:${secondColor}`);
    state = await runtime(different);
    add(assertions, "two different variants remain separate cart lines", state?.cart.items.length === 2 && state.cart.items[0]?.selectedOptions.size !== state.cart.items[1]?.selectedOptions.size);
    add(assertions, "two planned slots equal exactly two physical pieces", itemUnits(state) === 2 && state?.cart.targetItemCount === 2);
    add(assertions, "two-slot collection reaches cart review", state?.runtimeStage === "CART_REVIEW" && secondCompleted.stage === "CART_REVIEW");
    add(assertions, "final planned slot does not ask for quantity", !hasQuantityPrompt(secondCompleted));
    const commercial = evaluateCartCommercialState({ sellerId: SELLER_ID, productContext, fields, offerLookup: offers, cart: state!.cart, now: new Date() });
    add(assertions, "commercial evaluation uses the authoritative completed piece count", commercial.cartValid && commercial.standardPricing?.lines.reduce((total, line) => total + line.quantity, 0) === 2);
    const edit = await turn(different, "cart_review:edit");
    add(assertions, "explicit cart-review editing remains available", edit.handled === true && edit.stage === "CART_REVIEW");

    const staleBefore = JSON.stringify((await runtime(different))?.cart);
    const stale = await turn(different, "cart_quantity:1");
    add(assertions, "stale initial quantity action is safely recovered", Boolean(stale.reply?.includes("ما بقاش صالح")) && JSON.stringify((await runtime(different))?.cart) === staleBefore);

    const same = identity("same");
    await reset(same);
    await turn(same, "first_entry:order_now");
    await turn(same, "cart_quantity:2");
    await turn(same, `cart_item_option:size:${firstSize}`);
    const sameFirst = await turn(same, `cart_item_option:color:${firstColor}`);
    const sameSecond = await turn(same, "cart_item_previous:same");
    state = await runtime(same);
    add(assertions, "Same as Previous reuses the completed first slot", sameSecond.handled === true && state?.cart.items.length === 1 && state.cart.items[0]?.quantity === 2);
    add(assertions, "identical one-piece slots may merge to cart quantity 2", state?.cart.items[0]?.quantity === 2 && itemUnits(state) === 2);
    add(assertions, "Same as Previous reaches review without a quantity prompt", state?.runtimeStage === "CART_REVIEW" && !hasQuantityPrompt(sameFirst) && !hasQuantityPrompt(sameSecond));

    const three = identity("three");
    await reset(three);
    await turn(three, "first_entry:order_now");
    await turn(three, "cart_quantity:3");
    await turn(three, `cart_item_option:size:${firstSize}`);
    await turn(three, `cart_item_option:color:${firstColor}`);
    await turn(three, "cart_item_previous:same");
    const thirdComplete = await turn(three, "cart_item_previous:same");
    state = await runtime(three);
    add(assertions, "planned count 3 progresses through exactly three slots", state?.cart.targetItemCount === 3 && itemUnits(state) === 3 && state?.runtimeStage === "CART_REVIEW");
    add(assertions, "three-slot progression has no off-by-one slot", state?.cart.items[0]?.quantity === 3 && !hasQuantityPrompt(thirdComplete));

    const infoSize = identity("info-size");
    await reset(infoSize);
    const infoBoundary = await turn(infoSize, "first_entry:more_info");
    let session = await getConversationSession(infoSize.conversationKey, infoSize.sellerId, infoSize.productId, infoSize.customerPhone);
    add(assertions, "More Information remains outside the guarded cart before Continue Order", infoBoundary.handled === false && !session.orderRuntime && session.orderState.orderCycleId === undefined);
    await updateConversationProductInfoState({ ...infoSize, customerId: infoSize.conversationKey, pendingOrderSelections: { size: firstSize! } });
    session = await getConversationSession(infoSize.conversationKey, infoSize.sellerId, infoSize.productId, infoSize.customerPhone);
    add(assertions, "pending size stays outside the cart before explicit order", session.productInfo?.pendingOrderSelections?.size === firstSize && !session.orderRuntime && session.orderState.collected.size === undefined);
    const infoOrder = await turn(infoSize, "info:order_now");
    state = await runtime(infoSize);
    add(assertions, "info:order_now shares the canonical First Entry planner", state?.runtimeStage === "PLANNING" && state.lastHandledAction === "first_entry:order_now" && infoOrder.handled === true);
    const pendingSizeStart = await turn(infoSize, "cart_quantity:2");
    state = await runtime(infoSize);
    add(assertions, "pending size is reused for the first planned slot", state?.cart.currentItemDraft?.selectedOptions.size === firstSize && !pendingSizeStart.reply?.includes("المقاس"));
    add(assertions, "first pending-size slot asks only its remaining option", Boolean(pendingSizeStart.reply?.includes("اللون")) && !hasQuantityPrompt(pendingSizeStart));
    await turn(infoSize, `cart_item_option:color:${firstColor}`);
    const pendingDifferent = await turn(infoSize, "cart_item_previous:different");
    state = await runtime(infoSize);
    add(assertions, "second Different Choices slot does not force first-slot pending size", state?.cart.currentItemDraft?.selectedOptions.size === undefined && pendingDifferent.replyUi?.options?.some((option) => option.id.startsWith("cart_item_option:size:")) === true);

    const infoBoth = identity("info-both");
    await reset(infoBoth);
    await updateConversationProductInfoState({ ...infoBoth, customerId: infoBoth.conversationKey, pendingOrderSelections: { size: firstSize!, color: firstColor! } });
    await turn(infoBoth, "info:order_now");
    const bothStart = await turn(infoBoth, "cart_quantity:1");
    state = await runtime(infoBoth);
    add(assertions, "pending size and color both reuse on the first slot", state?.cart.items.length === 1 && state.cart.items[0]?.selectedOptions.size === firstSize && state.cart.items[0]?.selectedOptions.color === firstColor);
    add(assertions, "complete pending options bypass repeat option prompts", state?.runtimeStage === "CART_REVIEW" && !hasQuantityPrompt(bothStart));

    const infoInvalid = identity("info-invalid");
    await reset(infoInvalid);
    await updateConversationProductInfoState({ ...infoInvalid, customerId: infoInvalid.conversationKey, pendingOrderSelections: { size: "invalid-size", color: "invalid-color" } });
    await turn(infoInvalid, "info:order_now");
    const invalidStart = await turn(infoInvalid, "cart_quantity:1");
    state = await runtime(infoInvalid);
    add(assertions, "invalid pending options are ignored safely", Object.keys(state?.cart.currentItemDraft?.selectedOptions || {}).length === 0 && Boolean(invalidStart.reply?.includes("اختار")));
    add(assertions, "invalid pending options never create a completed cart item", state?.cart.items.length === 0 && state?.runtimeStage === "COLLECTING_ITEM");
  } finally {
    for (const scope of scopes) {
      await reset(scope);
    }
  }

  const passed = assertions.filter((assertion) => assertion.passed).length;
  return {
    phase: "6.3H2-R5",
    total: assertions.length,
    passed,
    failed: assertions.length - passed,
    strictAcceptance: assertions.length >= 30 && passed === assertions.length,
    noLiveSend: true,
    assertions,
  };
}
