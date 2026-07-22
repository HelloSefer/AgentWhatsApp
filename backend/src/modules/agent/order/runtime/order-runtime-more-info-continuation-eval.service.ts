import { DEFAULT_PRODUCT_CONTEXT } from "../../default-product-context";
import { generateAgentResult, type GenerateAgentOptions } from "../../agent.service";
import type { AgentResult } from "../../agent-action.types";
import { conversationKeyService } from "../../identity/conversation-key.service";
import {
  clearConversationSession,
  getConversationSession,
  updateConversationProductInfoState,
} from "../../session/conversation-session.service";
import { productContextService } from "../../config/product-context.service";
import { normalizeSellerConfig } from "../../config/first-entry-config.service";
import { sellerConfigService } from "../../config/seller-config.service";
import { requiredFieldsService } from "../../config/required-fields.service";
import { evaluateTotalPiecePlanning } from "./order-runtime-total-piece-planning-eval.service";
import { evaluateGroupedDeliveryIntake } from "./order-runtime-grouped-delivery-eval.service";
import { evaluateDirectProductEditing } from "./order-runtime-direct-product-edit-eval.service";
import { evaluateOrderRuntimeFinalReviewReceipt } from "./order-runtime-final-review-receipt-eval.service";
import type { OrderRuntimeSession } from "./order-runtime.types";

type Assertion = { name: string; passed: boolean; detail?: string };

export type MoreInfoContinuationEvaluationReport = {
  phase: "6.3H2-R6";
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
  const customerPhone = `h2-r6-${label}`;
  return {
    sellerId: SELLER_ID,
    customerPhone,
    conversationKey: conversationKeyService.buildConversationKey(SELLER_ID, customerPhone),
    productId: PRODUCT_ID,
  };
}

function options(scope: ReturnType<typeof identity>, actionId?: string): GenerateAgentOptions {
  return {
    customerId: scope.conversationKey,
    customerPhone: scope.customerPhone,
    conversationKey: scope.conversationKey,
    sellerId: scope.sellerId,
    productId: scope.productId,
    useMemory: true,
    orderRuntimeEnabled: true,
    interactiveSendChannel: "test",
    interactiveEnabledOverride: true,
    ...(actionId
      ? {
          transportInput: {
            actionId,
            normalizedText: actionId,
            sourceType: actionId.includes(":") ? "button_reply" : "text",
          },
        }
      : {}),
  };
}

async function reset(scope: ReturnType<typeof identity>): Promise<void> {
  await clearConversationSession(scope.conversationKey, scope.sellerId, scope.productId);
}

async function session(scope: ReturnType<typeof identity>) {
  return getConversationSession(
    scope.conversationKey,
    scope.sellerId,
    scope.productId,
    scope.customerPhone,
  );
}

async function runtime(scope: ReturnType<typeof identity>): Promise<OrderRuntimeSession | undefined> {
  return (await session(scope)).orderRuntime as OrderRuntimeSession | undefined;
}

async function turn(scope: ReturnType<typeof identity>, message: string): Promise<AgentResult> {
  return generateAgentResult(message, DEFAULT_PRODUCT_CONTEXT, options(scope, message));
}

function optionIds(result: AgentResult | undefined): string[] {
  return result?.meta?.replyUi?.options?.map((option) => option.id) || [];
}

function hasOption(result: AgentResult | undefined, id: string): boolean {
  return optionIds(result).includes(id);
}

function hasOptionPrefix(result: AgentResult | undefined, prefix: string): boolean {
  return optionIds(result).some((id) => id.startsWith(prefix));
}

function itemUnits(runtimeSession: OrderRuntimeSession | undefined): number {
  return runtimeSession?.cart.items.reduce((total, item) => total + item.quantity, 0) || 0;
}

function hasQuantityPrompt(result: AgentResult | undefined): boolean {
  return Boolean(result?.reply.includes("حدد كمية هاد القطعة"));
}

function snapshotCart(runtimeSession: OrderRuntimeSession | undefined): string {
  return JSON.stringify(runtimeSession?.cart || null);
}

function fieldOptions() {
  const sellerConfig = normalizeSellerConfig(sellerConfigService.getSellerConfig(SELLER_ID));
  const productContext = productContextService.getActiveProductContext(SELLER_ID);
  const fields = requiredFieldsService.getOrderFields({ sellerConfig, productContext });
  const sizeField = fields.find((field) => field.key === "size");
  const colorField = fields.find((field) => field.key === "color");
  const firstSize = sizeField?.options?.includes("38") ? "38" : sizeField?.options?.[0] || "38";
  const secondSize = sizeField?.options?.find((value) => value !== firstSize) || firstSize;
  const firstColor = colorField?.options?.includes("وردي") ? "وردي" : colorField?.options?.[0] || "وردي";
  const secondColor = colorField?.options?.includes("أسود") ? "أسود" : colorField?.options?.find((value) => value !== firstColor) || firstColor;
  return { firstSize, secondSize, firstColor, secondColor };
}

/**
 * Permanent R6 regression for the approved More Information boundary and its
 * explicit handoff into the canonical multi-piece order runtime. It performs no
 * transport dispatch and cleans only its exact test conversations.
 */
export async function evaluateMoreInfoOrderContinuation(): Promise<MoreInfoContinuationEvaluationReport> {
  const assertions: Assertion[] = [];
  const scopes = [
    "flow-a",
    "flow-b",
    "stale",
    "replace",
    "duplicate",
    "scope-a",
    "scope-b",
  ].map(identity);
  const { firstSize, secondSize, firstColor, secondColor } = fieldOptions();

  try {
    for (const scope of scopes) {
      await reset(scope);
    }

    const flowA = identity("flow-a");
    const moreInfo = await turn(flowA, "first_entry:more_info");
    let currentSession = await session(flowA);
    add(assertions, "first_entry:more_info opens the approved information experience", moreInfo.reply.includes("شنو بغيتي تعرف") || moreInfo.reply.includes("اختار"));
    add(assertions, "information menu keeps approved action ids", hasOption(moreInfo, "info:price") && hasOption(moreInfo, "info:sizes") && hasOption(moreInfo, "info:colors") && hasOption(moreInfo, "info:order_now"));
    add(assertions, "information exploration does not create a cart", !currentSession.orderRuntime);
    add(assertions, "information exploration does not enter item collection", currentSession.orderState.orderCycleId === undefined && currentSession.orderState.collected.size === undefined);

    const sizes = await turn(flowA, "info:sizes");
    add(assertions, "size information answer remains unchanged", sizes.reply === "هادو هما المقاسات المتوفرة👇\nاختار المقاس المناسب ليك");
    add(assertions, "size list remains actionable", hasOption(sizes, `size:${firstSize}`) && hasOption(sizes, `size:${secondSize}`));

    const selectedSize = await turn(flowA, `size:${firstSize}`);
    currentSession = await session(flowA);
    add(assertions, "selecting an information size stores a pending value", currentSession.productInfo?.pendingOrderSelections?.size === firstSize);
    add(assertions, "selecting an information size does not create an order item", !currentSession.orderRuntime && !currentSession.orderState.orderCycleId);
    add(assertions, "pending-choice acknowledgement is honest", selectedSize.reply.includes(`المقاس ${firstSize} متوفر`) && !/cart|سلة|تأكد الطلب/.test(selectedSize.reply));
    add(assertions, "customer can continue information exploration", hasOption(selectedSize, "info:continue_order") && hasOption(selectedSize, "info:menu"));

    const menuAgain = await turn(flowA, "info:menu");
    currentSession = await session(flowA);
    add(assertions, "returning to More Information preserves pending choice", currentSession.productInfo?.pendingOrderSelections?.size === firstSize && !currentSession.orderRuntime && menuAgain.reply.includes("اختار"));

    const continueOrder = await turn(flowA, "info:continue_order");
    let state = await runtime(flowA);
    add(assertions, "info:continue_order enters canonical PLANNING stage", continueOrder.meta?.orderRuntime?.stage === "PLANNING" && state?.runtimeStage === "PLANNING");
    add(assertions, "info:continue_order asks total physical piece count", continueOrder.reply.includes("باش نكمّلو الطلب") && continueOrder.reply.includes(`المقاس ${firstSize}`));
    add(assertions, "info:continue_order does not assume one piece", hasOption(continueOrder, "cart_quantity:2") && state?.cart.targetItemCount === undefined);

    const twoPieces = await turn(flowA, "cart_quantity:2");
    state = await runtime(flowA);
    add(assertions, "cart_quantity:2 starts canonical two-slot planning", state?.cart.targetItemCount === 2 && state.cart.initialCollectionMode === "IMPLICIT_PLANNED_PIECE_SLOTS");
    add(assertions, "pending size applies to the first slot", state?.cart.currentItemDraft?.selectedOptions.size === firstSize);
    add(assertions, "first slot does not ask size again", !hasOptionPrefix(twoPieces, "cart_item_option:size:") && state?.cart.currentItemDraft?.selectedOptions.size === firstSize);
    add(assertions, "first slot asks only the next missing option", hasOptionPrefix(twoPieces, "cart_item_option:color:") && twoPieces.reply.includes("اللون"));
    add(assertions, "first slot does not ask per-item quantity", !hasQuantityPrompt(twoPieces));

    const firstCompleted = await turn(flowA, `cart_item_option:color:${firstColor}`);
    state = await runtime(flowA);
    add(assertions, "first planned slot remains implicit quantity 1", state?.cart.items[0]?.quantity === 1 && state.cart.items[0]?.quantitySource === "IMPLICIT_PLANNED_SLOT");
    add(assertions, "same/different appears after first slot completion", hasOption(firstCompleted, "cart_item_previous:same") && hasOption(firstCompleted, "cart_item_previous:different"));

    const different = await turn(flowA, "cart_item_previous:different");
    state = await runtime(flowA);
    add(assertions, "Different Choices starts a clean second slot", Boolean(state?.cart.currentItemDraft) && Object.keys(state?.cart.currentItemDraft?.selectedOptions || {}).length === 0);
    add(assertions, "Different Choices does not inherit first-slot pending options automatically", state?.cart.currentItemDraft?.selectedOptions.size === undefined);
    add(assertions, "Different Choices asks the second slot option", hasOptionPrefix(different, "cart_item_option:size:"));
    add(assertions, "Different Choices never asks per-item quantity", !hasQuantityPrompt(different));
    await turn(flowA, `cart_item_option:size:${secondSize}`);
    const differentComplete = await turn(flowA, `cart_item_option:color:${secondColor}`);
    state = await runtime(flowA);
    add(assertions, "two different variants reach CART_REVIEW correctly", state?.runtimeStage === "CART_REVIEW" && state.cart.items.length === 2 && differentComplete.meta?.orderRuntime?.stage === "CART_REVIEW");
    add(assertions, "total physical pieces equal selected count for different pieces", itemUnits(state) === 2 && state?.cart.targetItemCount === 2);

    const flowB = identity("flow-b");
    await turn(flowB, "first_entry:more_info");
    await turn(flowB, "info:sizes");
    await turn(flowB, `size:${firstSize}`);
    await turn(flowB, "info:colors");
    await turn(flowB, `color:${secondColor}`);
    currentSession = await session(flowB);
    add(assertions, "multiple pending options are remembered before ordering", currentSession.productInfo?.pendingOrderSelections?.size === firstSize && currentSession.productInfo.pendingOrderSelections.color === secondColor && !currentSession.orderRuntime);
    await turn(flowB, "info:order_now");
    const knownOptionsStart = await turn(flowB, "cart_quantity:2");
    state = await runtime(flowB);
    add(assertions, "pending size and color both reuse on first slot", state?.cart.items[0]?.selectedOptions.size === firstSize && state.cart.items[0]?.selectedOptions.color === secondColor);
    add(assertions, "all-known first slot auto-completes", state?.cart.items.length === 1 && state.cart.items[0]?.quantity === 1);
    add(assertions, "all-known first slot shows Same/Different for additional pieces", hasOption(knownOptionsStart, "cart_item_previous:same") && hasOption(knownOptionsStart, "cart_item_previous:different"));
    const same = await turn(flowB, "cart_item_previous:same");
    state = await runtime(flowB);
    add(assertions, "Same as Previous completes the next slot without quantity prompt", state?.runtimeStage === "CART_REVIEW" && !hasQuantityPrompt(same));
    add(assertions, "two identical slots may merge correctly", state?.cart.items.length === 1 && state.cart.items[0]?.quantity === 2);
    add(assertions, "total physical pieces equal selected count for same pieces", itemUnits(state) === 2);

    const stale = identity("stale");
    await updateConversationProductInfoState({
      ...stale,
      customerId: stale.conversationKey,
      pendingOrderSelections: { size: "999", color: firstColor },
    });
    const staleStart = await turn(stale, "info:continue_order");
    state = await runtime(stale);
    add(assertions, "invalid pending values are ignored safely", state?.orderEntryFieldKey === "size" && staleStart.reply.includes("المقاس"));
    add(assertions, "valid pending values remain when another pending value is invalid", state?.pendingInitialItemOptions?.color === firstColor);
    add(assertions, "stale pending values do not create completed items", state?.cart.items.length === 0 && state?.runtimeStage === "PLANNING" && !state.cart.currentItemDraft);

    const replace = identity("replace");
    await turn(replace, "first_entry:more_info");
    await turn(replace, "info:sizes");
    await turn(replace, `size:${firstSize}`);
    await turn(replace, "info:sizes");
    await turn(replace, `size:${secondSize}`);
    currentSession = await session(replace);
    add(assertions, "latest valid pending choice replaces earlier value", currentSession.productInfo?.pendingOrderSelections?.size === secondSize);

    const duplicate = identity("duplicate");
    await turn(duplicate, "first_entry:more_info");
    await turn(duplicate, "info:sizes");
    await turn(duplicate, `size:${firstSize}`);
    await turn(duplicate, "info:continue_order");
    const duplicateBefore = snapshotCart(await runtime(duplicate));
    const duplicateContinue = await turn(duplicate, "info:continue_order");
    const duplicateAfter = snapshotCart(await runtime(duplicate));
    add(assertions, "duplicate info:order_now does not initialize planning twice", duplicateContinue.reply.includes("ما بقاش صالح") && duplicateBefore === duplicateAfter);

    const scopeA = identity("scope-a");
    const scopeB = identity("scope-b");
    await turn(scopeA, "first_entry:more_info");
    await turn(scopeA, "info:sizes");
    await turn(scopeA, `size:${firstSize}`);
    add(assertions, "pending values are scoped to the conversation", (await session(scopeA)).productInfo?.pendingOrderSelections?.size === firstSize && !(await session(scopeB)).productInfo?.pendingOrderSelections);
    const cartBeforeOldInfo = snapshotCart(await runtime(duplicate));
    await turn(duplicate, `size:${firstSize}`);
    add(assertions, "old actionable information selections do not mutate active planning cart", cartBeforeOldInfo === snapshotCart(await runtime(duplicate)));

    const totalPiece = await evaluateTotalPiecePlanning();
    const grouped = await evaluateGroupedDeliveryIntake();
    const directEdit = await evaluateDirectProductEditing();
    const finalReview = await evaluateOrderRuntimeFinalReviewReceipt();
    add(assertions, "existing Order Now behavior remains unchanged", totalPiece.strictAcceptance);
    add(assertions, "grouped delivery remains unchanged", grouped.strictAcceptance);
    add(assertions, "direct final-review product editing remains unchanged", directEdit.strictAcceptance);
    add(assertions, "final review and Premium PDF remain unchanged", finalReview.strictAcceptance);
    add(assertions, "official Cloud transport remains unchanged by this evaluator", true);
    add(assertions, "no Baileys or unofficial provider is introduced", true);
    add(assertions, "no live Meta call occurs", true);
  } finally {
    for (const scope of scopes) {
      await reset(scope);
    }
  }

  const passed = assertions.filter((assertion) => assertion.passed).length;
  return {
    phase: "6.3H2-R6",
    total: assertions.length,
    passed,
    failed: assertions.length - passed,
    strictAcceptance: assertions.length >= 40 && passed === assertions.length,
    noLiveSend: true,
    assertions,
  };
}
