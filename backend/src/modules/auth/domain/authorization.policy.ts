import type { AuthRole } from "./auth.types";

export const AUTH_PERMISSIONS = [
  "seller.read",
  "seller.manage",
  "catalog.read",
  "catalog.manage",
  "orders.read",
  "orders.manage",
  "conversation_config.read",
  "conversation_config.manage",
  "whatsapp_connection.read",
  "whatsapp_connection.manage",
  "memberships.read",
  "memberships.manage",
  "analytics.read",
] as const;

export type AuthPermission = typeof AUTH_PERMISSIONS[number];

const permissionSet = new Set<string>(AUTH_PERMISSIONS);

export const ROLE_PERMISSIONS: Readonly<Record<AuthRole, readonly AuthPermission[]>> = Object.freeze({
  OWNER: AUTH_PERMISSIONS,
  ADMIN: [
    "seller.read",
    "catalog.read",
    "catalog.manage",
    "orders.read",
    "orders.manage",
    "conversation_config.read",
    "conversation_config.manage",
    "whatsapp_connection.read",
    "whatsapp_connection.manage",
    "memberships.read",
    "analytics.read",
  ],
  AGENT: [
    "seller.read",
    "catalog.read",
    "orders.read",
    "orders.manage",
    "conversation_config.read",
    "analytics.read",
    "whatsapp_connection.read",
  ],
  VIEWER: [
    "seller.read",
    "catalog.read",
    "orders.read",
    "conversation_config.read",
    "analytics.read",
    "whatsapp_connection.read",
  ],
});

export function isAuthPermission(value: unknown): value is AuthPermission {
  return typeof value === "string" && permissionSet.has(value);
}

export function roleHasPermission(role: AuthRole, permission: AuthPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) === true;
}
