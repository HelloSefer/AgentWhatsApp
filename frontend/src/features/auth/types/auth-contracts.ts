export type AuthRole = "OWNER" | "ADMIN" | "AGENT" | "VIEWER";

export type AuthUser = Readonly<{
  userId: string;
  emailNormalized: string;
  status: "active" | "disabled";
  emailVerified: boolean;
}>;

export type AuthMembership = Readonly<{
  sellerId: string;
  role: AuthRole;
}>;

export type AuthSession = Readonly<{
  user: AuthUser;
  memberships: readonly AuthMembership[];
  needsOnboarding: boolean;
}>;

export type BackendAuthSession = Readonly<{
  user: AuthUser;
  activeMemberships: readonly AuthMembership[];
  needsOnboarding: boolean;
}>;

export type SignupInput = Readonly<{
  displayName: string;
  email: string;
  password: string;
}>;

export type LoginInput = Readonly<{
  email: string;
  password: string;
}>;

export type SafeAuthErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "email_exists"
  | "rate_limited"
  | "unauthenticated"
  | "service_unavailable";

export type SafeAuthError = Readonly<{
  code: SafeAuthErrorCode;
  message: string;
  status: number;
  retryAfterSeconds?: number;
}>;
