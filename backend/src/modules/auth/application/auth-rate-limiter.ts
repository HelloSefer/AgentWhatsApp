import { createHash } from "node:crypto";
import { normalizeEmail } from "../domain/auth.validation";

export type AuthRateLimitAction =
  | "signup"
  | "login"
  | "email_verification_request"
  | "password_forgot_request"
  | "google_start"
  | "onboarding_workspace_create"
  | "onboarding_logo_mutation"
  | "manual_whatsapp_setup"
  | "manual_whatsapp_discover"
  | "manual_whatsapp_select_assets"
  | "manual_whatsapp_configure_webhook"
  | "manual_whatsapp_finalize"
  | "development_tenant_reset";

export type AuthRateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds?: number;
}>;

export interface AuthRateLimitStore {
  increment(key: string, windowSeconds: number): Promise<Readonly<{ count: number; retryAfterSeconds: number }>>;
  clear(key: string): Promise<void>;
}

export class AuthRateLimitExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Auth rate limit exceeded.");
    this.name = "AuthRateLimitExceededError";
  }
}

const POLICY: Readonly<Record<AuthRateLimitAction, Readonly<{ limit: number; windowSeconds: number }>>> = Object.freeze({
  signup: { limit: 5, windowSeconds: 15 * 60 },
  login: { limit: 5, windowSeconds: 15 * 60 },
  email_verification_request: { limit: 5, windowSeconds: 15 * 60 },
  password_forgot_request: { limit: 5, windowSeconds: 15 * 60 },
  google_start: { limit: 20, windowSeconds: 10 * 60 },
  onboarding_workspace_create: { limit: 5, windowSeconds: 15 * 60 },
  onboarding_logo_mutation: { limit: 5, windowSeconds: 15 * 60 },
  manual_whatsapp_setup: { limit: 5, windowSeconds: 15 * 60 },
  manual_whatsapp_discover: { limit: 20, windowSeconds: 15 * 60 },
  manual_whatsapp_select_assets: { limit: 20, windowSeconds: 15 * 60 },
  manual_whatsapp_configure_webhook: { limit: 10, windowSeconds: 15 * 60 },
  manual_whatsapp_finalize: { limit: 10, windowSeconds: 15 * 60 },
  development_tenant_reset: { limit: 5, windowSeconds: 15 * 60 },
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeIdentifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "none";
  try {
    return `email:${sha256(normalizeEmail(value))}`;
  } catch {
    return `input:${sha256(value.trim().toLocaleLowerCase("en-US").slice(0, 320))}`;
  }
}

function normalizeIp(value: unknown): string {
  return typeof value === "string" && value.trim() ? sha256(value.trim()) : "unknown";
}

export class AuthRateLimiter {
  constructor(private readonly store: AuthRateLimitStore) {}

  buildKey(input: Readonly<{ action: AuthRateLimitAction; ip?: unknown; identifier?: unknown }>): string {
    return `auth:rate:${input.action}:ip:${normalizeIp(input.ip)}:id:${normalizeIdentifier(input.identifier)}`;
  }

  async consume(input: Readonly<{ action: AuthRateLimitAction; ip?: unknown; identifier?: unknown }>): Promise<AuthRateLimitDecision> {
    const policy = POLICY[input.action];
    const result = await this.store.increment(this.buildKey(input), policy.windowSeconds);
    if (result.count > policy.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, result.retryAfterSeconds) };
    }
    return { allowed: true };
  }

  async assertAllowed(input: Readonly<{ action: AuthRateLimitAction; ip?: unknown; identifier?: unknown }>): Promise<void> {
    const decision = await this.consume(input);
    if (!decision.allowed) throw new AuthRateLimitExceededError(decision.retryAfterSeconds ?? 60);
  }

  async clear(input: Readonly<{ action: AuthRateLimitAction; ip?: unknown; identifier?: unknown }>): Promise<void> {
    await this.store.clear(this.buildKey(input));
  }
}

export class InMemoryAuthRateLimitStore implements AuthRateLimitStore {
  readonly keys: string[] = [];
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  async increment(key: string, windowSeconds: number): Promise<Readonly<{ count: number; retryAfterSeconds: number }>> {
    this.keys.push(key);
    const now = Date.now();
    const existing = this.entries.get(key);
    const entry = existing && existing.expiresAt > now
      ? existing
      : { count: 0, expiresAt: now + windowSeconds * 1000 };
    entry.count += 1;
    this.entries.set(key, entry);
    return { count: entry.count, retryAfterSeconds: Math.ceil((entry.expiresAt - now) / 1000) };
  }

  async clear(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
