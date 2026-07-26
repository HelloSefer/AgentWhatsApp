import type { Request } from "express";
import type { TenantContext } from "../../../infrastructure/database";
import type { AuthorizedTenantContext } from "../application/authorization.types";
import type { AuthenticatedPrincipal } from "../application/session-auth.types";

export type AuthenticatedRequest = Request & Readonly<{
  auth: AuthenticatedPrincipal;
}>;

export type AuthorizedRequest = AuthenticatedRequest & Readonly<{
  tenant: TenantContext;
  authorization: AuthorizedTenantContext;
}>;
