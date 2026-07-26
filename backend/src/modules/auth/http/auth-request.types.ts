import type { Request } from "express";
import type { AuthenticatedPrincipal } from "../application/session-auth.types";

export type AuthenticatedRequest = Request & Readonly<{
  auth: AuthenticatedPrincipal;
}>;
