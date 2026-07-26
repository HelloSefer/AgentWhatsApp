export const AUTH_ROLES = ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const;
export type AuthRole = typeof AUTH_ROLES[number];

export const AUTH_STATUSES = ["active", "disabled"] as const;
export type AuthStatus = typeof AUTH_STATUSES[number];

export type AuthUser = Readonly<{
  userId: string;
  emailNormalized: string;
  status: AuthStatus;
  emailVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}>;

export type PasswordCredential = Readonly<{
  userId: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ExternalIdentity = Readonly<{
  externalIdentityId: string;
  userId: string;
  provider: string;
  providerSubject: string;
  emailNormalized?: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AuthSession = Readonly<{
  sessionId: string;
  userId: string;
  sessionTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt?: Date;
  revokedAt?: Date;
}>;

export type EmailVerificationToken = Readonly<{
  tokenId: string;
  userId: string;
  tokenHash: string;
  emailNormalized: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
}>;

export type PasswordResetToken = Readonly<{
  tokenId: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
}>;

export type SellerMembership = Readonly<{
  sellerId: string;
  userId: string;
  role: AuthRole;
  status: AuthStatus;
  createdAt: Date;
  updatedAt: Date;
  disabledAt?: Date;
}>;
