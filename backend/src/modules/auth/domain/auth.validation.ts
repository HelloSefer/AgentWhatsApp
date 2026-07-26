import { createTenantContext } from "../../../infrastructure/database";
import { AuthValidationError } from "./auth.errors";
import { AUTH_ROLES, AUTH_STATUSES, type AuthRole, type AuthStatus } from "./auth.types";

export const AUTH_ID_MAX_LENGTH = 128;
export const AUTH_PROVIDER_MAX_LENGTH = 80;
export const AUTH_PROVIDER_SUBJECT_MAX_LENGTH = 255;
export const AUTH_HASH_MAX_LENGTH = 500;
export const AUTH_EMAIL_MAX_LENGTH = 320;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function requiredString(value: unknown, maximum: number): string {
  if (typeof value !== "string") throw new AuthValidationError();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) throw new AuthValidationError();
  return trimmed;
}

export function normalizeEmail(value: unknown): string {
  const email = requiredString(value, AUTH_EMAIL_MAX_LENGTH).normalize("NFKC").toLocaleLowerCase("en-US");
  if (!EMAIL_PATTERN.test(email)) throw new AuthValidationError();
  return email;
}

export function validateAuthId(value: unknown): string {
  return requiredString(value, AUTH_ID_MAX_LENGTH);
}

export function validateHash(value: unknown): string {
  return requiredString(value, AUTH_HASH_MAX_LENGTH);
}

export function validateOpaqueTokenHash(value: unknown): string {
  const hash = validateHash(value);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new AuthValidationError();
  return hash;
}

export function validateProvider(value: unknown): string {
  return requiredString(value, AUTH_PROVIDER_MAX_LENGTH).normalize("NFKC").toLocaleLowerCase("en-US");
}

export function validateProviderSubject(value: unknown): string {
  return requiredString(value, AUTH_PROVIDER_SUBJECT_MAX_LENGTH);
}

export function validateAuthStatus(value: unknown): AuthStatus {
  if (!AUTH_STATUSES.includes(value as AuthStatus)) throw new AuthValidationError();
  return value as AuthStatus;
}

export function validateAuthRole(value: unknown): AuthRole {
  if (!AUTH_ROLES.includes(value as AuthRole)) throw new AuthValidationError();
  return value as AuthRole;
}

export function validateExpiry(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AuthValidationError();
  return date;
}

export function validateSellerMembershipSellerId(value: unknown): string {
  try {
    return createTenantContext(value).sellerId;
  } catch {
    throw new AuthValidationError();
  }
}
