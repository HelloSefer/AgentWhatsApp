import { createHash, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { getValkeyClient } from "../../../../infrastructure/valkey/valkey.client";
import type {
  ConversationOrderingCoordinator,
  ConversationOrderingIdentity,
  ConversationOrderingState,
  ConversationTurnClaim,
  ConversationTurnClaimResult,
  ConversationTurnCompleteResult,
  ConversationTurnReleaseResult,
  ConversationTurnRenewResult,
  ReservedConversationTurn,
} from "../contracts/conversation-ordering.types";
import { ConversationOrderingError } from "../conversation-ordering.errors";

export const CONVERSATION_ORDERING_KEY_PREFIX = "agentwhatsapp:conversation-ordering:v1";
export const CONVERSATION_ORDERING_TTL_SECONDS = 10_800;
export const CONVERSATION_ORDERING_LEASE_MS = 2_000;
export const CONVERSATION_ORDERING_RENEW_INTERVAL_MS = 500;
export const CONVERSATION_ORDERING_DEFER_MS = 150;

const RESERVE_SCRIPT = `
local seqKey = KEYS[1]
local msgKey = KEYS[2]
local expectedKey = KEYS[3]
local ttl = tonumber(ARGV[1])
local existing = redis.call("GET", msgKey)
if existing then
  redis.call("EXPIRE", seqKey, ttl)
  redis.call("EXPIRE", msgKey, ttl)
  redis.call("EXPIRE", expectedKey, ttl)
  return {existing, "existing"}
end
local seq = redis.call("INCR", seqKey)
redis.call("SET", msgKey, seq, "EX", ttl)
redis.call("SETNX", expectedKey, 1)
redis.call("EXPIRE", seqKey, ttl)
redis.call("EXPIRE", expectedKey, ttl)
return {tostring(seq), "reserved"}
`;

const CLAIM_SCRIPT = `
local expectedKey = KEYS[1]
local leaseKey = KEYS[2]
local completedKey = KEYS[3]
local sequence = tonumber(ARGV[1])
local token = ARGV[2]
local leaseMs = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local nowMs = tonumber(ARGV[5])
local expected = tonumber(redis.call("GET", expectedKey) or "1")
if sequence < expected or redis.call("SISMEMBER", completedKey, sequence) == 1 then
  return {"alreadyCompleted", tostring(expected)}
end
if sequence > expected then
  local leaseRaw = redis.call("GET", leaseKey)
  local active = ""
  if leaseRaw then active = string.match(leaseRaw, '"sequence":(%d+)') or "" end
  return {"wait", tostring(expected), active}
end
local leaseRaw = redis.call("GET", leaseKey)
if leaseRaw then
  local active = string.match(leaseRaw, '"sequence":(%d+)') or ""
  return {"wait", tostring(expected), active}
end
local lease = '{"token":"' .. token .. '","sequence":' .. sequence .. ',"expiresAtMs":' .. (nowMs + leaseMs) .. '}'
redis.call("SET", leaseKey, lease, "PX", leaseMs)
redis.call("EXPIRE", expectedKey, ttl)
redis.call("EXPIRE", completedKey, ttl)
return {"claimed", tostring(sequence), token, tostring(nowMs + leaseMs)}
`;

const RENEW_SCRIPT = `
local leaseKey = KEYS[1]
local expectedKey = KEYS[2]
local completedKey = KEYS[3]
local token = ARGV[1]
local sequence = tonumber(ARGV[2])
local leaseMs = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local nowMs = tonumber(ARGV[5])
local leaseRaw = redis.call("GET", leaseKey)
if not leaseRaw or not string.find(leaseRaw, token, 1, true) then
  return {"lostLease"}
end
local active = tonumber(string.match(leaseRaw, '"sequence":(%d+)') or "-1")
if active ~= sequence then
  return {"lostLease"}
end
local lease = '{"token":"' .. token .. '","sequence":' .. sequence .. ',"expiresAtMs":' .. (nowMs + leaseMs) .. '}'
redis.call("SET", leaseKey, lease, "PX", leaseMs)
redis.call("EXPIRE", expectedKey, ttl)
redis.call("EXPIRE", completedKey, ttl)
return {"renewed", tostring(nowMs + leaseMs)}
`;

const COMPLETE_SCRIPT = `
local expectedKey = KEYS[1]
local leaseKey = KEYS[2]
local completedKey = KEYS[3]
local sequence = tonumber(ARGV[1])
local token = ARGV[2]
local ttl = tonumber(ARGV[3])
local expected = tonumber(redis.call("GET", expectedKey) or "1")
if sequence < expected or redis.call("SISMEMBER", completedKey, sequence) == 1 then
  return {"alreadyCompleted", tostring(expected)}
end
local leaseRaw = redis.call("GET", leaseKey)
if not leaseRaw or not string.find(leaseRaw, token, 1, true) then
  return {"lostLease"}
end
local active = tonumber(string.match(leaseRaw, '"sequence":(%d+)') or "-1")
if active ~= sequence or expected ~= sequence then
  return {"lostLease"}
end
redis.call("SADD", completedKey, sequence)
redis.call("SET", expectedKey, sequence + 1, "EX", ttl)
redis.call("EXPIRE", completedKey, ttl)
redis.call("DEL", leaseKey)
return {"completed", tostring(sequence + 1)}
`;

const RELEASE_SCRIPT = `
local leaseKey = KEYS[1]
local token = ARGV[1]
local sequence = tonumber(ARGV[2])
local leaseRaw = redis.call("GET", leaseKey)
if not leaseRaw then
  return {"lostLease"}
end
if not string.find(leaseRaw, token, 1, true) then
  return {"lostLease"}
end
local active = tonumber(string.match(leaseRaw, '"sequence":(%d+)') or "-1")
if active ~= sequence then
  return {"lostLease"}
end
redis.call("DEL", leaseKey)
return {"released"}
`;

function hashPart(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function requireClean(value: string, category: "sequence_reservation_unavailable" | "invalid_sequence"): string {
  const clean = value.trim();
  if (!clean) throw new ConversationOrderingError(category);
  return clean;
}

function parseArrayResult(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ConversationOrderingError("ordering_state_unavailable");
  return value.map((item) => String(item));
}

export function buildConversationOrderingKey(identity: Pick<ConversationOrderingIdentity, "sellerId" | "conversationKey">): string {
  const sellerId = requireClean(identity.sellerId, "sequence_reservation_unavailable");
  const conversationKey = requireClean(identity.conversationKey, "sequence_reservation_unavailable");
  return hashPart(JSON.stringify([sellerId, conversationKey]));
}

export function buildConversationOrderingMessageKey(identity: ConversationOrderingIdentity): string {
  return hashPart(JSON.stringify([
    requireClean(identity.sellerId, "sequence_reservation_unavailable"),
    requireClean(identity.conversationKey, "sequence_reservation_unavailable"),
    requireClean(identity.messageId, "sequence_reservation_unavailable"),
  ]));
}

type OrderingKeys = Readonly<{
  seq: string;
  msg: string;
  expected: string;
  lease: string;
  completed: string;
}>;

function keysFor(orderingKey: string, messageKey?: string): OrderingKeys {
  const base = `${CONVERSATION_ORDERING_KEY_PREFIX}:${orderingKey}`;
  return {
    seq: `${base}:seq`,
    msg: `${base}:msg:${messageKey || "none"}`,
    expected: `${base}:expected`,
    lease: `${base}:lease`,
    completed: `${base}:completed`,
  };
}

export class ValkeyConversationOrderingAdapter implements ConversationOrderingCoordinator {
  constructor(
    private readonly getClient: () => Redis = getValkeyClient,
    private readonly ttlSeconds = CONVERSATION_ORDERING_TTL_SECONDS,
    private readonly leaseMs = CONVERSATION_ORDERING_LEASE_MS,
  ) {}

  async reserveTurn(identity: ConversationOrderingIdentity): Promise<ReservedConversationTurn> {
    const orderingKey = buildConversationOrderingKey(identity);
    const messageKey = buildConversationOrderingMessageKey(identity);
    const keys = keysFor(orderingKey, messageKey);
    try {
      const result = parseArrayResult(await this.getClient().eval(
        RESERVE_SCRIPT,
        3,
        keys.seq,
        keys.msg,
        keys.expected,
        String(this.ttlSeconds),
      ));
      const sequence = Number(result[0]);
      if (!Number.isInteger(sequence) || sequence < 1) {
        throw new ConversationOrderingError("invalid_sequence");
      }
      return { orderingKey, messageKey, sequence };
    } catch (error) {
      if (error instanceof ConversationOrderingError) throw error;
      throw new ConversationOrderingError("sequence_reservation_unavailable", error);
    }
  }

  async tryClaimTurn(
    turn: Pick<ReservedConversationTurn, "orderingKey" | "sequence">,
    leaseOwner: string,
  ): Promise<ConversationTurnClaimResult> {
    if (!Number.isInteger(turn.sequence) || turn.sequence < 1) {
      return { status: "invalidTurn" };
    }
    const token = hashPart(`${leaseOwner}:${randomUUID()}`);
    const nowMs = Date.now();
    const keys = keysFor(turn.orderingKey);
    const result = parseArrayResult(await this.getClient().eval(
      CLAIM_SCRIPT,
      3,
      keys.expected,
      keys.lease,
      keys.completed,
      String(turn.sequence),
      token,
      String(this.leaseMs),
      String(this.ttlSeconds),
      String(nowMs),
    ));
    if (result[0] === "claimed") {
      return {
        status: "claimed",
        claim: {
          orderingKey: turn.orderingKey,
          sequence: turn.sequence,
          ownerToken: token,
          leaseExpiresAt: new Date(Number(result[3])).toISOString(),
        },
      };
    }
    if (result[0] === "alreadyCompleted") {
      return { status: "alreadyCompleted", expectedSequence: Number(result[1]) };
    }
    if (result[0] === "wait") {
      return {
        status: "wait",
        expectedSequence: Number(result[1]),
        ...(result[2] ? { activeSequence: Number(result[2]) } : {}),
      };
    }
    return { status: "invalidTurn" };
  }

  async renewTurnLease(claim: ConversationTurnClaim): Promise<ConversationTurnRenewResult> {
    const keys = keysFor(claim.orderingKey);
    const result = parseArrayResult(await this.getClient().eval(
      RENEW_SCRIPT,
      3,
      keys.lease,
      keys.expected,
      keys.completed,
      claim.ownerToken,
      String(claim.sequence),
      String(this.leaseMs),
      String(this.ttlSeconds),
      String(Date.now()),
    ));
    if (result[0] !== "renewed") return { status: "lostLease" };
    return { status: "renewed", leaseExpiresAt: new Date(Number(result[1])).toISOString() };
  }

  async completeTurn(claim: ConversationTurnClaim): Promise<ConversationTurnCompleteResult> {
    const keys = keysFor(claim.orderingKey);
    const result = parseArrayResult(await this.getClient().eval(
      COMPLETE_SCRIPT,
      3,
      keys.expected,
      keys.lease,
      keys.completed,
      String(claim.sequence),
      claim.ownerToken,
      String(this.ttlSeconds),
    ));
    if (result[0] === "completed") {
      return { status: "completed", nextExpectedSequence: Number(result[1]) };
    }
    if (result[0] === "alreadyCompleted") {
      return { status: "alreadyCompleted", expectedSequence: Number(result[1]) };
    }
    return { status: "lostLease" };
  }

  async releaseTurn(claim: ConversationTurnClaim): Promise<ConversationTurnReleaseResult> {
    const keys = keysFor(claim.orderingKey);
    const result = parseArrayResult(await this.getClient().eval(
      RELEASE_SCRIPT,
      1,
      keys.lease,
      claim.ownerToken,
      String(claim.sequence),
    ));
    return result[0] === "released" ? { status: "released" } : { status: "lostLease" };
  }

  async inspectTurnState(orderingKey: string): Promise<ConversationOrderingState> {
    const keys = keysFor(orderingKey);
    const client = this.getClient();
    const [nextRaw, expectedRaw, leaseRaw, leaseTtlMs] = await Promise.all([
      client.get(keys.seq),
      client.get(keys.expected),
      client.get(keys.lease),
      client.pttl(keys.lease),
    ]);
    const lease = typeof leaseRaw === "string" ? JSON.parse(leaseRaw) as { sequence?: unknown } : {};
    const activeSequence = typeof lease.sequence === "number" ? lease.sequence : undefined;
    return {
      orderingKey,
      nextSequence: Number(nextRaw || "0"),
      expectedSequence: Number(expectedRaw || "1"),
      ...(activeSequence ? { activeSequence } : {}),
      ...(leaseTtlMs > 0 ? { leaseTtlMs } : {}),
    };
  }

  async cleanupTestOrderingState(orderingKeys: readonly string[]): Promise<number> {
    const keys = orderingKeys.flatMap((orderingKey) => {
      const base = `${CONVERSATION_ORDERING_KEY_PREFIX}:${orderingKey}`;
      return [
        `${base}:seq`,
        `${base}:expected`,
        `${base}:lease`,
        `${base}:completed`,
      ];
    });
    const msgPatterns = orderingKeys.map((orderingKey) => `${CONVERSATION_ORDERING_KEY_PREFIX}:${orderingKey}:msg:*`);
    const client = this.getClient();
    const msgKeys: string[] = [];
    for (const pattern of msgPatterns) {
      const found = await client.keys(pattern);
      msgKeys.push(...found);
    }
    const all = [...keys, ...msgKeys];
    if (!all.length) return 0;
    return client.del(...all);
  }
}
