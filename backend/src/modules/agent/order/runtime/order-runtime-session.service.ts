import {
  clearConversationSession,
  getConversationSession,
  saveConversationSession,
} from "../../session/conversation-session.service";
import { evaluateCartIntegrity, initializeCart } from "../cart-state.service";
import type { RequiredOrderField } from "../../config/required-fields.types";
import {
  ORDER_RUNTIME_SESSION_VERSION,
  type OrderRuntimeSession,
} from "./order-runtime.types";

type RuntimeIdentity = {
  sellerId: string;
  customerPhone: string;
  conversationKey: string;
  productId: string;
};

function safeReceiptText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function createRuntimeSession(identity: RuntimeIdentity): OrderRuntimeSession {
  return {
    version: ORDER_RUNTIME_SESSION_VERSION,
    sellerId: identity.sellerId,
    customerPhone: identity.customerPhone,
    conversationKey: identity.conversationKey,
    productId: identity.productId,
    cart: initializeCart(),
    runtimeStage: "FIRST_ENTRY",
    updatedAt: new Date().toISOString(),
  };
}

function isRuntimeSession(value: unknown, identity: RuntimeIdentity, fields: RequiredOrderField[]): value is OrderRuntimeSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OrderRuntimeSession>;
  if (
    candidate.version !== ORDER_RUNTIME_SESSION_VERSION ||
    candidate.sellerId !== identity.sellerId ||
    candidate.customerPhone !== identity.customerPhone ||
    candidate.conversationKey !== identity.conversationKey ||
    candidate.productId !== identity.productId ||
    !candidate.cart ||
    typeof candidate.runtimeStage !== "string"
  ) return false;
  return evaluateCartIntegrity({ cart: candidate.cart, fields }).valid;
}

export async function loadOrderRuntimeSession(input: RuntimeIdentity & { fields: RequiredOrderField[] }): Promise<{ runtime: OrderRuntimeSession; recovered: boolean }> {
  const session = await getConversationSession(
    input.conversationKey,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );
  if (isRuntimeSession(session.orderRuntime, input, input.fields)) {
    return { runtime: structuredClone(session.orderRuntime), recovered: false };
  }
  const runtime = createRuntimeSession(input);
  if (session.orderRuntime) {
    session.orderRuntime = runtime;
    await saveConversationSession(session);
  }
  return { runtime, recovered: Boolean(session.orderRuntime) };
}

export async function saveOrderRuntimeSession(input: RuntimeIdentity & { runtime: OrderRuntimeSession; fields: RequiredOrderField[] }): Promise<void> {
  if (!isRuntimeSession(input.runtime, input, input.fields)) {
    throw new Error("Invalid order runtime session");
  }
  const session = await getConversationSession(
    input.conversationKey,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );
  session.orderRuntime = {
    ...structuredClone(input.runtime),
    updatedAt: new Date().toISOString(),
  };
  await saveConversationSession(session);
}

export async function recordOrderRuntimeReceiptDispatch(input: RuntimeIdentity & {
  snapshotId: string;
  status: "SENT" | "FAILED" | "SKIPPED";
  at: string;
  cloudMessageIdMasked?: string;
  failureCode?: string;
  failureMessage?: string;
}): Promise<boolean> {
  const session = await getConversationSession(
    input.conversationKey,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );
  const runtime = session.orderRuntime as OrderRuntimeSession | undefined;
  if (
    !runtime ||
    runtime.sellerId !== input.sellerId ||
    runtime.customerPhone !== input.customerPhone ||
    runtime.conversationKey !== input.conversationKey ||
    runtime.productId !== input.productId ||
    runtime.runtimeStage !== "CONFIRMED" ||
    runtime.confirmed?.snapshotId !== input.snapshotId
  ) return false;

  if (runtime.confirmed.receipt.dispatchStatus === "SENT") {
    return input.status === "SENT";
  }

  runtime.confirmed.receipt = {
    ...runtime.confirmed.receipt,
    dispatchStatus: input.status,
    ...(input.status === "SENT" ? { sentAt: input.at } : {}),
    ...(input.status === "FAILED" ? { failedAt: input.at } : {}),
    ...(input.status === "SKIPPED" ? { skippedAt: input.at } : {}),
    ...(safeReceiptText(input.cloudMessageIdMasked, 120)
      ? { cloudMessageIdMasked: safeReceiptText(input.cloudMessageIdMasked, 120) }
      : {}),
    ...(safeReceiptText(input.failureCode, 80)
      ? { failureCode: safeReceiptText(input.failureCode, 80) }
      : {}),
    ...(safeReceiptText(input.failureMessage, 320)
      ? { failureMessage: safeReceiptText(input.failureMessage, 320) }
      : {}),
  };
  runtime.updatedAt = new Date().toISOString();
  session.orderRuntime = structuredClone(runtime);
  await saveConversationSession(session);
  return true;
}

export async function clearOrderRuntimeSession(input: RuntimeIdentity): Promise<void> {
  const session = await getConversationSession(
    input.conversationKey,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );
  delete session.orderRuntime;
  await saveConversationSession(session);
}

/**
 * Explicit smoke/admin reset for one exact conversation. It removes the
 * runtime and legacy flow markers together without touching other Valkey keys.
 */
export async function resetOrderRuntimeConversation(input: RuntimeIdentity): Promise<boolean> {
  return clearConversationSession(
    input.conversationKey,
    input.sellerId,
    input.productId,
  );
}
