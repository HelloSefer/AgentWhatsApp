import { getConversationSession, saveConversationSession } from "../../session/conversation-session.service";
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
