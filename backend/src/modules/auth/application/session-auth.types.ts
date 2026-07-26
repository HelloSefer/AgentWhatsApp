import type { AuthRole, AuthUser } from "../domain/auth.types";

export type AuthenticatedMembership = Readonly<{
  sellerId: string;
  role: AuthRole;
}>;

export type SanitizedAuthUser = Readonly<{
  userId: string;
  emailNormalized: string;
  status: "active" | "disabled";
  emailVerified: boolean;
}>;

export type AuthenticatedPrincipal = Readonly<{
  userId: string;
  sessionId: string;
  user: SanitizedAuthUser;
  activeMemberships: readonly AuthenticatedMembership[];
  needsOnboarding: boolean;
}>;

export type SessionIssueResult = Readonly<{
  user: SanitizedAuthUser;
  activeMemberships: readonly AuthenticatedMembership[];
  needsOnboarding: boolean;
  session: Readonly<{
    rawToken: string;
    expiresAt: Date;
  }>;
}>;

export type CurrentUserResult = Omit<AuthenticatedPrincipal, "sessionId">;

export function sanitizeAuthUser(user: AuthUser): SanitizedAuthUser {
  return {
    userId: user.userId,
    emailNormalized: user.emailNormalized,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== undefined,
  };
}
