import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getValkeyClient } from "../../../../infrastructure/valkey/valkey.client";
import { conversationKeyService } from "../../identity/conversation-key.service";
import { productContextService } from "../../config/product-context.service";
import { getConversationSession } from "../../session/conversation-session.service";
import {
  getOrderRuntimeReadiness,
  processGuardedOrderRuntimeTurn,
} from "./order-runtime-router.service";
import { clearOrderRuntimeSession } from "./order-runtime-session.service";
import type {
  OrderRuntimeSession,
  OrderRuntimeStage,
  OrderRuntimeTurnResult,
} from "./order-runtime.types";

type Assertion = {
  name: string;
  passed: boolean;
  detail?: string;
};

type RuntimeEvalSummary = {
  phase: "6.3H1";
  total: number;
  passed: number;
  failed: number;
  strictAcceptance: boolean;
  realValkey: boolean;
  finalStage?: OrderRuntimeStage;
  containsPdfBuffer: boolean;
  liveSendAttempted: boolean;
  blocker?: string;
};

export type OrderRuntimeEvaluationReport = RuntimeEvalSummary & {
  assertions: Assertion[];
  scenario: {
    sellerId: string;
    customerRef: string;
    isolatedCustomerRef: string;
    productId: string;
  };
};

const PHASE = "6.3H1" as const;
const SELLER_ID = "seller_demo_sandals";
const UNKNOWN_SELLER_ID = "seller_runtime_not_allowlisted";
const PRODUCT_ID = "prod_demo_sandal_001";
const CUSTOMER_PHONE = "h1-eval-runtime";
const ISOLATED_CUSTOMER_PHONE = "h1-eval-runtime-isolated";

function maskRef(value: string): string {
  return value.length <= 4 ? "***" : `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function add(assertions: Assertion[], name: string, passed: boolean, detail?: string): void {
  assertions.push({ name, passed, ...(passed ? {} : { detail }) });
}

function containsPdfBuffer(runtime: OrderRuntimeSession | undefined): boolean {
  if (!runtime) return false;
  const json = JSON.stringify(runtime);
  return /"buffer"\s*:|Buffer|Uint8Array|base64,/i.test(json);
}

function hasMetaTransportSource(source: string): boolean {
  return /graph\.facebook\.com|whatsapp-cloud|cloud\/|sendCtaUrl|sendText|sendDocument|sendMessage|media upload|bullmq|postgres|prisma|typeorm/i.test(source);
}

function getRuntimeSource(): string {
  return [
    "order-runtime-router.service.ts",
    "order-runtime-session.service.ts",
    "order-runtime-reply.service.ts",
    "order-runtime.types.ts",
  ]
    .map((file) => readFileSync(join(process.cwd(), "src", "modules", "agent", "order", "runtime", file), "utf8"))
    .join("\n");
}

function identity(customerPhone: string) {
  return {
    sellerId: SELLER_ID,
    customerPhone,
    conversationKey: conversationKeyService.buildConversationKey(SELLER_ID, customerPhone),
    productId: PRODUCT_ID,
  };
}

async function turn(customerPhone: string, message: string, activationRequested = true): Promise<OrderRuntimeTurnResult> {
  const scoped = identity(customerPhone);
  return processGuardedOrderRuntimeTurn({
    ...scoped,
    message,
    activationRequested,
  });
}

async function loadRuntime(customerPhone: string): Promise<OrderRuntimeSession | undefined> {
  const scoped = identity(customerPhone);
  const session = await getConversationSession(
    scoped.conversationKey,
    scoped.sellerId,
    scoped.productId,
    scoped.customerPhone,
  );
  return session.orderRuntime as OrderRuntimeSession | undefined;
}

async function clearRuntime(customerPhone: string): Promise<void> {
  await clearOrderRuntimeSession(identity(customerPhone));
}

async function assertStage(assertions: Assertion[], customerPhone: string, expected: OrderRuntimeStage, label: string): Promise<OrderRuntimeSession | undefined> {
  const runtime = await loadRuntime(customerPhone);
  add(assertions, label, runtime?.runtimeStage === expected, `expected ${expected}, got ${runtime?.runtimeStage || "missing"}`);
  return runtime;
}

function optionValue(runtime: OrderRuntimeSession | undefined, key: string): unknown {
  return runtime?.cart.currentItemDraft?.selectedOptions[key];
}

function completedOption(runtime: OrderRuntimeSession | undefined, index: number, key: string): unknown {
  return runtime?.cart.items[index]?.selectedOptions[key];
}

function completedQuantity(runtime: OrderRuntimeSession | undefined, index: number): unknown {
  return runtime?.cart.items[index]?.quantity;
}

function completedUnits(runtime: OrderRuntimeSession | undefined): number {
  return runtime?.cart.items.reduce((total, item) => total + item.quantity, 0) || 0;
}

async function buildReviewedCart(customerPhone: string): Promise<OrderRuntimeSession | undefined> {
  await clearRuntime(customerPhone);
  await turn(customerPhone, "first_entry:order_now");
  await turn(customerPhone, "cart_item_option:size:38");
  await turn(customerPhone, "cart_quantity:2");
  await turn(customerPhone, "cart_item_option:color:أسود");
  await turn(customerPhone, "cart_item_previous:different");
  await turn(customerPhone, "cart_item_option:size:40");
  await turn(customerPhone, "cart_item_option:color:وردي");
  return loadRuntime(customerPhone);
}

async function runIsolatedChecks(assertions: Assertion[]): Promise<void> {
  await clearRuntime(ISOLATED_CUSTOMER_PHONE);
  await turn(ISOLATED_CUSTOMER_PHONE, "first_entry:order_now");
  const isolatedBefore = await loadRuntime(ISOLATED_CUSTOMER_PHONE);
  await clearRuntime(CUSTOMER_PHONE);
  const isolatedAfter = await loadRuntime(ISOLATED_CUSTOMER_PHONE);
  const mainAfterReset = await loadRuntime(CUSTOMER_PHONE);

  add(assertions, "two customer sessions remain isolated", isolatedBefore?.runtimeStage === "PLANNING" && isolatedAfter?.runtimeStage === "PLANNING");
  add(assertions, "reset affects only the requested conversation", (!mainAfterReset || mainAfterReset.runtimeStage === "FIRST_ENTRY") && isolatedAfter?.runtimeStage === "PLANNING");
  await clearRuntime(ISOLATED_CUSTOMER_PHONE);
}

async function runWrongFieldCheck(assertions: Assertion[]): Promise<void> {
  const customerPhone = "h1-eval-runtime-wrong-field";
  await clearRuntime(customerPhone);
  await turn(customerPhone, "first_entry:order_now");
  const before = await loadRuntime(customerPhone);
  const result = await turn(customerPhone, "cart_item_option:color:أسود");
  const after = await loadRuntime(customerPhone);

  add(assertions, "wrong-field action is rejected", after?.cart.currentItemDraft?.selectedOptions.color === undefined && optionValue(after, "size") === optionValue(before, "size"), result.failureCode || "color was not stored before size");
  add(assertions, "invalid commands do not partially persist state", JSON.stringify(before?.cart.currentItemDraft?.selectedOptions || {}) === JSON.stringify(after?.cart.currentItemDraft?.selectedOptions || {}));
  await clearRuntime(customerPhone);
}

async function runCartReviewMutationChecks(assertions: Assertion[]): Promise<void> {
  const quantityCustomerPhone = "h1-eval-runtime-quantity-edit";
  let runtime = await buildReviewedCart(quantityCustomerPhone);
  const quantityItemId = runtime?.cart.items[0]?.id || "";
  await turn(quantityCustomerPhone, "cart_review:edit");
  await turn(quantityCustomerPhone, `cart_review_item:select:${quantityItemId}`);
  await turn(quantityCustomerPhone, `cart_review_item:quantity:${quantityItemId}`);
  await turn(quantityCustomerPhone, "2");
  runtime = await loadRuntime(quantityCustomerPhone);
  add(assertions, "cart quantity edit persists after reload", completedQuantity(runtime, 0) === 2 && runtime?.cart.targetItemCount === 3);
  await clearRuntime(quantityCustomerPhone);

  const optionCustomerPhone = "h1-eval-runtime-option-edit";
  runtime = await buildReviewedCart(optionCustomerPhone);
  const optionItemId = runtime?.cart.items[0]?.id || "";
  await turn(optionCustomerPhone, "cart_review:edit");
  await turn(optionCustomerPhone, `cart_review_item:select:${optionItemId}`);
  await turn(optionCustomerPhone, `cart_review_item:option:size:${optionItemId}`);
  await turn(optionCustomerPhone, "cart_item_option:size:39");
  runtime = await loadRuntime(optionCustomerPhone);
  add(assertions, "completed-item option edit remains atomic", completedOption(runtime, 0, "size") === "39" && completedOption(runtime, 0, "color") === "أسود");
  await clearRuntime(optionCustomerPhone);
}

/**
 * Permanent H1 closure evaluator. It intentionally drives the guarded runtime
 * router and reloads Valkey-backed session state after meaningful boundaries.
 */
export async function evaluateGuardedOrderRuntime(): Promise<OrderRuntimeEvaluationReport> {
  const assertions: Assertion[] = [];
  let realValkey = false;
  let blocker: string | undefined;
  let finalStage: OrderRuntimeStage | undefined;
  let pdfBufferStored = false;

  try {
    realValkey = (await getValkeyClient().ping()) === "PONG";
  } catch (error) {
    blocker = error instanceof Error ? error.message : "Valkey ping failed";
  }

  if (!realValkey) {
    add(assertions, "real Valkey is reachable", false, blocker || "Valkey did not return PONG");
    return {
      phase: PHASE,
      total: assertions.length,
      passed: 0,
      failed: assertions.length,
      strictAcceptance: false,
      realValkey: false,
      containsPdfBuffer: false,
      liveSendAttempted: false,
      blocker: blocker || "Valkey unavailable",
      assertions,
      scenario: {
        sellerId: SELLER_ID,
        customerRef: maskRef(CUSTOMER_PHONE),
        isolatedCustomerRef: maskRef(ISOLATED_CUSTOMER_PHONE),
        productId: PRODUCT_ID,
      },
    };
  }

  await clearRuntime(CUSTOMER_PHONE);
  await clearRuntime(ISOLATED_CUSTOMER_PHONE);

  const readinessDefault = await getOrderRuntimeReadiness(SELLER_ID, false);
  const readinessEnabled = await getOrderRuntimeReadiness(SELLER_ID, true);
  const readinessUnknown = await getOrderRuntimeReadiness(UNKNOWN_SELLER_ID, true);
  add(assertions, "runtime is disabled by default", readinessDefault.flowEnabled === false && readinessDefault.reason === "feature_disabled");
  add(assertions, "explicit orderRuntimeEnabled true is required", (await turn(CUSTOMER_PHONE, "first_entry:order_now", false)).handled === false);
  add(assertions, "non-allowlisted seller remains disabled", readinessUnknown.flowEnabled === false);
  add(assertions, "allowed seller enters guarded runtime", readinessEnabled.flowEnabled === true && readinessEnabled.runtimeMode === "guarded" && readinessEnabled.valkeyReady === true);

  await runIsolatedChecks(assertions);
  await clearRuntime(CUSTOMER_PHONE);

  await turn(CUSTOMER_PHONE, "سلام");
  const clean = await loadRuntime(CUSTOMER_PHONE);
  add(assertions, "clean session starts at FIRST_ENTRY", clean?.runtimeStage === "FIRST_ENTRY");
  const ignoredQuantity = await turn(CUSTOMER_PHONE, "2");
  let runtime = await assertStage(assertions, CUSTOMER_PHONE, "FIRST_ENTRY", "quantity is parsed only in the expected planning state");
  add(assertions, "AgentReply and uiHints are generated", Boolean(ignoredQuantity.reply && ignoredQuantity.replyUi?.options?.length));

  const orderNow = await turn(CUSTOMER_PHONE, "first_entry:order_now");
  runtime = await assertStage(assertions, CUSTOMER_PHONE, "PLANNING", "Order Now enters PLANNING");
  add(assertions, "planning reply is generated", Boolean(orderNow.reply));
  add(assertions, "configured option order is respected", orderNow.replyUi?.options?.[0]?.id === "cart_item_option:size:36");

  await turn(CUSTOMER_PHONE, "cart_item_option:size:38");
  const oneItem = await turn(CUSTOMER_PHONE, "cart_quantity:2");
  runtime = await assertStage(assertions, CUSTOMER_PHONE, "COLLECTING_ITEM", "item collection starts exactly one current draft");
  add(assertions, "cart target quantity persists after planning", runtime?.cart.targetItemCount === 2 && runtime.cart.items.length === 0 && Boolean(runtime.cart.currentItemDraft));
  add(assertions, "first planned slot asks the next configured option", oneItem.replyUi?.options?.[0]?.id?.startsWith("cart_item_option:color:") === true);

  await runWrongFieldCheck(assertions);

  runtime = await loadRuntime(CUSTOMER_PHONE);
  add(assertions, "valid option persists in Valkey", optionValue(runtime, "size") === "38");
  await turn(CUSTOMER_PHONE, "cart_item_option:color:أسود");
  runtime = await loadRuntime(CUSTOMER_PHONE);
  add(assertions, "color option completes the first planned slot", completedOption(runtime, 0, "color") === "أسود");
  add(assertions, "planned item uses implicit quantity one", completedQuantity(runtime, 0) === 1);
  add(assertions, "first item finalizes", runtime?.cart.items.length === 1 && completedOption(runtime, 0, "size") === "38" && completedOption(runtime, 0, "color") === "أسود");
  add(assertions, "next item starts automatically", Boolean(runtime?.cart.currentItemDraft) && runtime?.runtimeStage === "COLLECTING_ITEM");

  const same = await turn(CUSTOMER_PHONE, "cart_item_previous:same");
  runtime = await loadRuntime(CUSTOMER_PHONE);
  add(assertions, "Same as Previous works", completedOption(runtime, 0, "size") === "38" && completedOption(runtime, 0, "color") === "أسود" && completedUnits(runtime) === 2 && Boolean(same.reply));
  runtime = await assertStage(assertions, CUSTOMER_PHONE, "CART_REVIEW", "multi-item target reaches CART_REVIEW");
  add(assertions, "cart review contains two completed units", completedUnits(runtime) === 2 && !runtime?.cart.currentItemDraft);

  await runCartReviewMutationChecks(assertions);

  await turn(CUSTOMER_PHONE, "cart_review:continue");
  runtime = await assertStage(assertions, CUSTOMER_PHONE, "COLLECTING_DELIVERY", "review continue enters delivery collection");
  add(assertions, "delivery fields are collected in configured order", runtime?.deliveryConfirmationState?.currentFieldKey === "fullName");

  const beforeItemFieldAsDelivery = JSON.stringify(runtime?.cart.orderLevelFields || {});
  await turn(CUSTOMER_PHONE, "cart_item_option:size:40");
  runtime = await loadRuntime(CUSTOMER_PHONE);
  add(assertions, "item fields are not collected as delivery fields", JSON.stringify(runtime?.cart.orderLevelFields || {}) === beforeItemFieldAsDelivery && runtime?.deliveryConfirmationState?.currentFieldKey === "fullName");

  await turn(CUSTOMER_PHONE, "عمر العزري");
  await turn(CUSTOMER_PHONE, "0612345678");
  await turn(CUSTOMER_PHONE, "منطقة الأمل الشرقية");
  await turn(CUSTOMER_PHONE, "حي السلام زنقة 4 رقم 12");
  runtime = await assertStage(assertions, CUSTOMER_PHONE, "FINAL_ORDER_REVIEW", "final review stage is reached");
  add(assertions, "final review contains all completed units and order fields", completedUnits(runtime) === 2 && runtime?.cart.orderLevelFields.fullName === "عمر العزري" && runtime.cart.orderLevelFields.phone === "0612345678" && runtime.cart.orderLevelFields.city === "منطقة الأمل الشرقية" && runtime.cart.orderLevelFields.address === "حي السلام زنقة 4 رقم 12");

  const finalReviewJson = JSON.stringify(runtime?.cart || {});
  const fakePrice = await turn(CUSTOMER_PHONE, "total:1");
  runtime = await loadRuntime(CUSTOMER_PHONE);
  add(assertions, "request prices and totals are not trusted", JSON.stringify(runtime?.cart || {}) === finalReviewJson && (fakePrice.handled === false || runtime?.runtimeStage === "FINAL_ORDER_REVIEW"));
  add(assertions, "selected offers are not silently replaced", runtime?.cart.selectedOfferId === undefined && runtime?.cart.mode === "STANDARD");

  const confirm = await turn(CUSTOMER_PHONE, "order_checkout:confirm");
  runtime = await assertStage(assertions, CUSTOMER_PHONE, "CONFIRMED", "explicit confirm reaches CONFIRMED");
  finalStage = runtime?.runtimeStage;
  add(assertions, "confirmed snapshot metadata exists", Boolean(confirm.confirmedSnapshotId && runtime?.confirmed?.snapshotId === confirm.confirmedSnapshotId));
  add(assertions, "receipt metadata exists", Boolean(runtime?.confirmed?.receipt?.filename && runtime.confirmed.receipt.byteLength > 0 && runtime.confirmed.receipt.checksum));
  pdfBufferStored = containsPdfBuffer(runtime);
  add(assertions, "PDF Buffer is not stored in Valkey", !pdfBufferStored);

  const confirmedBefore = JSON.stringify(runtime);
  await turn(CUSTOMER_PHONE, "cart_review:edit");
  runtime = await loadRuntime(CUSTOMER_PHONE);
  add(assertions, "confirmed state blocks later cart mutation", JSON.stringify(runtime) === confirmedBefore);
  add(assertions, "seller/customer scope remains unchanged", runtime?.sellerId === SELLER_ID && runtime.customerPhone === CUSTOMER_PHONE && runtime.conversationKey === identity(CUSTOMER_PHONE).conversationKey);

  const runtimeSource = getRuntimeSource();
  add(assertions, "no Cloud or Meta call occurs", !/graph\.facebook\.com|Meta Send|Cloud API/i.test(runtimeSource) && !hasMetaTransportSource(runtimeSource.replace(/whatsappInteractiveChoicesEnabled|whatsappCloudReplyButtonsEnabled/g, "")));
  add(assertions, "no live WhatsApp send, DB, queue, or worker is used", !/sendMessage|sendDocument|bullmq|worker|queue|postgres|prisma|typeorm/i.test(runtimeSource));

  const passed = assertions.filter((assertion) => assertion.passed).length;
  const failed = assertions.length - passed;

  return {
    phase: PHASE,
    total: assertions.length,
    passed,
    failed,
    strictAcceptance: failed === 0 && assertions.length >= 25 && realValkey && finalStage === "CONFIRMED" && !pdfBufferStored,
    realValkey,
    finalStage,
    containsPdfBuffer: pdfBufferStored,
    liveSendAttempted: false,
    assertions,
    scenario: {
      sellerId: SELLER_ID,
      customerRef: maskRef(CUSTOMER_PHONE),
      isolatedCustomerRef: maskRef(ISOLATED_CUSTOMER_PHONE),
      productId: productContextService.getActiveProductContext(SELLER_ID).productId,
    },
  };
}
