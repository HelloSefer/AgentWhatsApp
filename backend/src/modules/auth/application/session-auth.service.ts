import { randomUUID } from "node:crypto";
import { generateOpaqueToken, hashOpaqueToken } from "../../../infrastructure/security/opaque-token";
import type { AuthRepositories } from "../contracts/auth.repository";
import { AuthInvalidCredentialsError, AuthInvalidTokenError } from "../domain/auth.errors";
import type { AuthUser } from "../domain/auth.types";
import { PasswordAuthService } from "./password-auth.service";
import type { PasswordLoginInput, PasswordSignupInput } from "./password-auth.types";
import {
  type AuthenticatedMembership,
  type AuthenticatedPrincipal,
  type CurrentUserResult,
  type SessionIssueResult,
  sanitizeAuthUser,
} from "./session-auth.types";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function expiresAt(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

function activeMemberships(memberships: Awaited<ReturnType<AuthRepositories["listSellerMembershipsForUser"]>>): readonly AuthenticatedMembership[] {
  return memberships
    .filter((membership) => membership.status === "active")
    .map((membership) => ({ sellerId: membership.sellerId, role: membership.role }));
}

export class SessionAuthService {
  constructor(
    private readonly repositories: AuthRepositories,
    private readonly passwordAuthService: PasswordAuthService,
  ) {}

  async signup(input: PasswordSignupInput): Promise<SessionIssueResult> {
    const result = await this.passwordAuthService.signup(input);
    return this.issueSessionForUser(result.user);
  }

  async login(input: PasswordLoginInput): Promise<SessionIssueResult> {
    const result = await this.passwordAuthService.login(input);
    return this.issueSessionForUser(result.user);
  }

  async resolve(rawToken: unknown): Promise<AuthenticatedPrincipal | null> {
    const tokenHash = hashOpaqueToken(rawToken);
    if (!tokenHash) return null;

    const session = await this.repositories.findSessionByTokenHash(tokenHash);
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    const user = await this.repositories.findUserById(session.userId);
    if (!user || user.status !== "active") return null;

    await this.repositories.touchSession(session.sessionId, new Date());
    const memberships = activeMemberships(await this.repositories.listSellerMembershipsForUser(user.userId));
    return {
      userId: user.userId,
      sessionId: session.sessionId,
      user: sanitizeAuthUser(user),
      activeMemberships: memberships,
      needsOnboarding: memberships.length === 0,
    };
  }

  async currentUser(rawToken: unknown): Promise<CurrentUserResult> {
    const principal = await this.resolve(rawToken);
    if (!principal) throw new AuthInvalidCredentialsError();
    return {
      userId: principal.userId,
      user: principal.user,
      activeMemberships: principal.activeMemberships,
      needsOnboarding: principal.needsOnboarding,
    };
  }

  async logout(rawToken: unknown): Promise<void> {
    const tokenHash = hashOpaqueToken(rawToken);
    if (!tokenHash) return;
    const session = await this.repositories.findSessionByTokenHash(tokenHash);
    if (!session || session.revokedAt) return;
    await this.repositories.revokeSession(session.sessionId, new Date());
  }

  async revokeAllSessionsForUser(userId: string): Promise<number> {
    return this.repositories.revokeActiveSessionsForUser(userId, new Date());
  }

  async issueSessionForUser(user: AuthUser): Promise<SessionIssueResult> {
    if (user.status !== "active") throw new AuthInvalidCredentialsError();
    const rawToken = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(rawToken);
    if (!tokenHash) throw new AuthInvalidTokenError();
    const sessionExpiresAt = expiresAt();
    await this.repositories.createSession({
      sessionId: randomUUID(),
      userId: user.userId,
      sessionTokenHash: tokenHash,
      expiresAt: sessionExpiresAt,
    });
    const memberships = activeMemberships(await this.repositories.listSellerMembershipsForUser(user.userId));
    return {
      user: sanitizeAuthUser(user),
      activeMemberships: memberships,
      needsOnboarding: memberships.length === 0,
      session: {
        rawToken,
        expiresAt: sessionExpiresAt,
      },
    };
  }
}

export const AUTH_SESSION_TTL_MS = SESSION_TTL_MS;
