import type { TenantContext } from "../../../infrastructure/database";
import type { AuthenticatedPrincipal } from "./session-auth.types";
import type { AuthPermission } from "../domain/authorization.policy";
import type { AuthRole } from "../domain/auth.types";

export type AuthorizationInput = Readonly<{
  principal?: AuthenticatedPrincipal;
  requestedSellerId?: unknown;
  permission: AuthPermission;
}>;

export type AuthorizedTenantContext = Readonly<{
  principal: AuthenticatedPrincipal;
  tenant: TenantContext;
  sellerId: string;
  role: AuthRole;
  permission: AuthPermission;
}>;
