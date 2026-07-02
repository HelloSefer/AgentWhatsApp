import { env } from "../../../config/env";
import { getValkeyClient } from "../../../infrastructure/valkey/valkey.client";
import type {
  ConversationMessage,
  ConversationSession,
  OrderEntities,
} from "../agent-brain.types";

type SessionIdentity = {
  customerId: string;
  sellerId?: string;
  productId?: string;
};

type AppendConversationMessageInput = SessionIdentity & {
  role: ConversationMessage["role"];
  text: string;
};

type UpdateConversationOrderStateInput = SessionIdentity & {
  collected?: Partial<OrderEntities>;
  missingFields?: string[];
  isComplete?: boolean;
  awaitingConfirmation?: boolean;
  confirmed?: boolean;
};

const MAX_SESSION_MESSAGES = 20;

function getExpiryIsoDate(): string {
  return new Date(Date.now() + env.sessionTtlSeconds * 1000).toISOString();
}

export function buildSessionKey(
  customerId: string,
  sellerId?: string,
  productId?: string,
): string {
  return `agent:session:${sellerId || "default-seller"}:${
    productId || "default-product"
  }:${customerId}`;
}

export function createEmptySession(input: SessionIdentity): ConversationSession {
  const now = new Date().toISOString();
  const sessionId = buildSessionKey(
    input.customerId,
    input.sellerId,
    input.productId,
  );

  return {
    sessionId,
    customerId: input.customerId,
    sellerId: input.sellerId,
    productId: input.productId,
    messages: [],
    orderState: {
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
): Promise<ConversationSession> {
  const sessionKey = buildSessionKey(customerId, sellerId, productId);
  const client = getValkeyClient();
  const rawSession = await client.get(sessionKey);

  if (!rawSession) {
    const session = createEmptySession({ customerId, sellerId, productId });
    await saveConversationSession(session);
    return session;
  }

  try {
    return JSON.parse(rawSession) as ConversationSession;
  } catch (_error) {
    const session = createEmptySession({ customerId, sellerId, productId });
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
  );

  session.orderState = {
    ...session.orderState,
    collected: {
      ...session.orderState.collected,
      ...(input.collected || {}),
    },
    missingFields: input.missingFields ?? session.orderState.missingFields,
    isComplete: input.isComplete ?? session.orderState.isComplete,
    awaitingConfirmation:
      input.awaitingConfirmation ?? session.orderState.awaitingConfirmation ?? false,
    confirmed: input.confirmed ?? session.orderState.confirmed ?? false,
    lastUpdatedAt: new Date().toISOString(),
  };

  await saveConversationSession(session);

  return session;
}

export async function clearConversationSession(
  customerId: string,
  sellerId?: string,
  productId?: string,
): Promise<void> {
  const sessionKey = buildSessionKey(customerId, sellerId, productId);
  const client = getValkeyClient();

  await client.del(sessionKey);
}
