import type { NextFunction, Request, Response } from "express";
import type { AuthorizationService } from "../application/authorization.service";
import {
  AuthorizationForbiddenError,
  AuthorizationInvalidSellerTargetError,
  AuthorizationTenantSelectionRequiredError,
  AuthorizationUnauthenticatedError,
} from "../application/authorization.errors";
import type { SessionAuthService } from "../application/session-auth.service";
import type { AuthPermission } from "../domain/authorization.policy";
import { readAuthCookie } from "./auth-cookie";
import type { AuthenticatedRequest } from "./auth-request.types";

export type RequestedSellerIdResolver = (req: Request) => unknown;

export function requireAuthenticatedPrincipal(sessionAuthService: SessionAuthService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawToken = readAuthCookie(req.headers.cookie);
    const principal = await sessionAuthService.resolve(rawToken);
    if (!principal) {
      res.status(401).json({ message: "Authentication required." });
      return;
    }
    (req as Request & { auth?: typeof principal }).auth = principal;
    next();
  };
}

export const authenticateRequest = requireAuthenticatedPrincipal;

function sendAuthorizationFailure(res: Response, error: unknown): void {
  if (error instanceof AuthorizationUnauthenticatedError) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }
  if (error instanceof AuthorizationInvalidSellerTargetError) {
    res.status(400).json({ message: "Invalid seller target." });
    return;
  }
  if (error instanceof AuthorizationTenantSelectionRequiredError) {
    res.status(409).json({ message: "Seller selection required." });
    return;
  }
  if (error instanceof AuthorizationForbiddenError) {
    res.status(403).json({ message: "Forbidden." });
    return;
  }
  res.status(500).json({ message: "Authorization service unavailable." });
}

export function resolveAuthorizedTenantContext(
  authorizationService: AuthorizationService,
  permission: AuthPermission,
  resolveRequestedSellerId: RequestedSellerIdResolver = () => undefined,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const principal = (req as Partial<AuthenticatedRequest>).auth;
      if (!principal) throw new AuthorizationUnauthenticatedError();
      const authorization = await authorizationService.authorize({
        principal,
        requestedSellerId: resolveRequestedSellerId(req),
        permission,
      });
      (req as Request & { auth?: typeof principal; tenant?: typeof authorization.tenant; authorization?: typeof authorization }).auth = principal;
      (req as Request & { tenant?: typeof authorization.tenant }).tenant = authorization.tenant;
      (req as Request & { authorization?: typeof authorization }).authorization = authorization;
      next();
    } catch (error) {
      sendAuthorizationFailure(res, error);
    }
  };
}

export const requirePermission = resolveAuthorizedTenantContext;
