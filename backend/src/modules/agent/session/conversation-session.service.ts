import { env } from "../../../config/env";
import { getValkeyClient } from "../../../infrastructure/valkey/valkey.client";
import type {
  ConversationMessage,
  ConversationSession,
  OrderEntities,
} from "../agent-brain.types";
import { conversationKeyService } from "../identity/conversation-key.service";
import { DEFAULT_DEMO_SELLER_ID } from "../identity/seller-resolver.service";

type SessionIdentity = {
  customerId: string;
  customerPhone?: string;
  conversationKey?: string;
  sellerId?: string;
  productId?: string;
};

type AppendConversationMessageInput = SessionIdentity & {
  role: ConversationMessage["role"];
  text: string;
};

type UpdateConversationOrderStateInput = SessionIdentity & {
  orderCycleId?: string;
  collected?: Partial<OrderEntities>;
  replaceCollected?: boolean;
  missingFields?: string[];
  isComplete?: boolean;
  awaitingConfirmation?: boolean;
  confirmed?: boolean;
  editField?: ConversationSession["orderState"]["editField"] | null;
  clearProductInfo?: boolean;
};

type UpdateConversationProductInfoStateInput = SessionIdentity & {
  lastTopic?: NonNullable<ConversationSession["productInfo"]>["lastTopic"];
  pendingSelection?: NonNullable<ConversationSession["productInfo"]>["pendingSelection"];
};

const MAX_SESSION_MESSAGES = 20;

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed || undefined;
}

function parseConversationKey(conversationKey: string): {
  sellerId?: string;
  customerPhone?: string;
} {
  const separatorIndex = conversationKey.indexOf(":");

  if (separatorIndex <= 0) {
    return {};
  }

  return {
    sellerId: cleanText(conversationKey.slice(0, separatorIndex)),
    customerPhone: cleanText(conversationKey.slice(separatorIndex + 1)),
  };
}

function resolveSessionIdentity(input: SessionIdentity): Required<
  Pick<SessionIdentity, "customerId" | "conversationKey">
> &
  Omit<SessionIdentity, "customerId" | "conversationKey"> {
  const explicitConversationKey = cleanText(input.conversationKey);
  const cleanCustomerId = cleanText(input.customerId);

  if (explicitConversationKey) {
    const parsed = parseConversationKey(explicitConversationKey);

    return {
      ...input,
      customerId: explicitConversationKey,
      conversationKey: explicitConversationKey,
      sellerId: cleanText(input.sellerId) || parsed.sellerId,
      customerPhone: cleanText(input.customerPhone) || parsed.customerPhone,
    };
  }

  if (!cleanCustomerId) {
    throw new Error("customerId is required");
  }

  const parsed = parseConversationKey(cleanCustomerId);

  if (parsed.sellerId && parsed.customerPhone) {
    return {
      ...input,
      customerId: cleanCustomerId,
      conversationKey: cleanCustomerId,
      sellerId: cleanText(input.sellerId) || parsed.sellerId,
      customerPhone: cleanText(input.customerPhone) || parsed.customerPhone,
    };
  }

  const sellerId = cleanText(input.sellerId) || DEFAULT_DEMO_SELLER_ID;
  const customerPhone = cleanText(input.customerPhone) || cleanCustomerId;
  const conversationKey = conversationKeyService.buildConversationKey(
    sellerId,
    customerPhone,
  );

  return {
    ...input,
    customerId: conversationKey,
    conversationKey,
    sellerId,
    customerPhone,
  };
}

function getExpiryIsoDate(): string {
  return new Date(Date.now() + env.sessionTtlSeconds * 1000).toISOString();
}

export function buildSessionKey(
  customerId: string,
  sellerId?: string,
  _productId?: string,
): string {
  const identity = resolveSessionIdentity({ customerId, sellerId });

  return conversationKeyService.buildSessionKey(identity.conversationKey);
}

export function createEmptySession(input: SessionIdentity): ConversationSession {
  const identity = resolveSessionIdentity(input);
  const now = new Date().toISOString();
  const sessionId = buildSessionKey(
    identity.customerId,
    identity.sellerId,
    identity.productId,
  );

  return {
    sessionId,
    customerId: identity.customerId,
    customerPhone: identity.customerPhone,
    conversationKey: identity.conversationKey,
    sellerId: identity.sellerId,
    productId: identity.productId,
    messages: [],
    orderState: {
      orderCycleId: undefined,
      collected: {},
      missingFields: [],
      isComplete: false,
      awaitingConfirmation: false,
      confirmed: false,
      lastUpdatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    expiresAt: getExpiryIsoDate(),
  };
}

export async function saveConversationSession(
  session: ConversationSession,
): Promise<void> {
  const now = new Date().toISOString();
  const sessionToSave: ConversationSession = {
    ...session,
    updatedAt: now,
    expiresAt: getExpiryIsoDate(),
  };
  const client = getValkeyClient();

  await client.set(
    sessionToSave.sessionId,
    JSON.stringify(sessionToSave),
    "EX",
    env.sessionTtlSeconds,
  );

  Object.assign(session, sessionToSave);
}

export async function getConversationSession(
  customerId: string,
  sellerId?: string,
  productId?: string,
  customerPhone?: string,
): Promise<ConversationSession> {
  const identity = resolveSessionIdentity({
    customerId,
    sellerId,
    productId,
    customerPhone,
  });
  const sessionKey = buildSessionKey(
    identity.customerId,
    identity.sellerId,
    identity.productId,
  );
  const client = getValkeyClient();
  const rawSession = await client.get(sessionKey);

  if (!rawSession) {
    const session = createEmptySession(identity);
    await saveConversationSession(session);
    return session;
  }

  try {
    const session = JSON.parse(rawSession) as ConversationSession;

    return {
      ...session,
      customerId: session.customerId || identity.customerId,
      customerPhone: session.customerPhone || identity.customerPhone,
      conversationKey: session.conversationKey || identity.conversationKey,
      sellerId: session.sellerId || identity.sellerId,
      productId: session.productId || identity.productId,
    };
  } catch (_error) {
    const session = createEmptySession(identity);
    await saveConversationSession(session);
    return session;
  }
}

export async function appendConversationMessage(
  input: AppendConversationMessageInput,
): Promise<ConversationSession> {
  const session = await getConversationSession(
    input.customerId,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );

  session.messages.push({
    role: input.role,
    text: input.text,
    timestamp: new Date().toISOString(),
  });
  session.messages = session.messages.slice(-MAX_SESSION_MESSAGES);

  await saveConversationSession(session);

  return session;
}

export async function updateConversationOrderState(
  input: UpdateConversationOrderStateInput,
): Promise<ConversationSession> {
  const session = await getConversationSession(
    input.customerId,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );

  session.orderState = {
    ...session.orderState,
    ...(input.orderCycleId ? { orderCycleId: input.orderCycleId } : {}),
    collected: input.replaceCollected
      ? { ...(input.collected || {}) }
      : {
          ...session.orderState.collected,
          ...(input.collected || {}),
        },
    missingFields: input.missingFields ?? session.orderState.missingFields,
    isComplete: input.isComplete ?? session.orderState.isComplete,
    awaitingConfirmation:
      input.awaitingConfirmation ?? session.orderState.awaitingConfirmation ?? false,
    confirmed: input.confirmed ?? session.orderState.confirmed ?? false,
    editField:
      input.editField === null
        ? undefined
        : input.editField ?? session.orderState.editField,
    lastUpdatedAt: new Date().toISOString(),
  };

  if (input.clearProductInfo) {
    session.productInfo = undefined;
  }

  await saveConversationSession(session);

  return session;
}

export async function updateConversationProductInfoState(
  input: UpdateConversationProductInfoStateInput,
): Promise<ConversationSession> {
  const session = await getConversationSession(
    input.customerId,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );

  session.productInfo = {
    ...(session.productInfo || {}),
    ...(input.lastTopic ? { lastTopic: input.lastTopic } : {}),
    pendingSelection: input.pendingSelection,
    lastUpdatedAt: new Date().toISOString(),
  };

  await saveConversationSession(session);

  return session;
}

export async function clearConversationProductInfoSelection(
  input: SessionIdentity,
): Promise<ConversationSession> {
  const session = await getConversationSession(
    input.customerId,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );

  if (session.productInfo?.pendingSelection) {
    session.productInfo = {
      ...session.productInfo,
      pendingSelection: undefined,
      lastUpdatedAt: new Date().toISOString(),
    };

    await saveConversationSession(session);
  }

  return session;
}

export async function appendSellerBrainReplyKey(
  input: SessionIdentity & {
    replyKey: string;
    intent?: string;
  },
): Promise<ConversationSession> {
  const session = await getConversationSession(
    input.customerId,
    input.sellerId,
    input.productId,
    input.customerPhone,
  );
  const recentReplyKeys = [
    ...(session.sellerBrain?.recentReplyKeys || []).filter(
      (replyKey) => replyKey !== input.replyKey,
    ),
    input.replyKey,
  ].slice(-5);

  session.sellerBrain = {
    recentReplyKeys,
    lastIntent: input.intent ?? session.sellerBrain?.lastIntent,
    lastReplyAt: new Date().toISOString(),
  };

  await saveConversationSession(session);

  return session;
}

export async function clearConversationSession(
  customerId: string,
  sellerId?: string,
  productId?: string,
): Promise<boolean> {
  const sessionKey = buildSessionKey(customerId, sellerId, productId);
  const client = getValkeyClient();
  const deletedCount = await client.del(sessionKey);

  return deletedCount > 0;
}
