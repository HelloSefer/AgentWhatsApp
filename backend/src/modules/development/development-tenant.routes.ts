import { Router, type Request, type Response } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import { requireAuthenticatedPrincipal, requirePermission } from "../auth/http/auth.middleware";
import { rateLimitAuth } from "../auth/http/auth-rate-limit.middleware";
import type { AuthorizedRequest } from "../auth/http/auth-request.types";
import { getValkeyClient } from "../../infrastructure/valkey/valkey.client";
import { DevelopmentTenantConversationResetService } from "./development-tenant-conversation-reset.service";
import { DevelopmentTenantResolutionError, DevelopmentTenantService } from "./development-tenant.service";

function disabled(): boolean { return (process.env.NODE_ENV || "development").trim().toLowerCase() === "production"; }
function isEmptyBody(req: Request): boolean {
  return typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) && Object.keys(req.body as Record<string, unknown>).length === 0;
}
function safeError(res: Response, error: unknown): Response {
  if (error instanceof DevelopmentTenantResolutionError) return res.status(error.code === "NOT_CONFIGURED" ? 409 : 503).json({ issueCode: error.code });
  if (error instanceof Error && error.message === "DEVELOPMENT_RESET_DISABLED") return res.status(404).json({ message: "Route not found" });
  return res.status(503).json({ issueCode: "DEVELOPMENT_TENANT_UNAVAILABLE" });
}
export function createDevelopmentTenantRoutes(): Router {
  const router = Router(); const auth = createAuthComposition(); const service = new DevelopmentTenantService();
  const authenticate = requireAuthenticatedPrincipal(auth.sessionAuthService);
  const authorize = requirePermission(auth.authorizationService, "catalog.manage");
  const ensureDevelopmentMember = async (req: Request, res: Response, next: () => void): Promise<void> => {
    if (disabled()) { res.status(404).json({ message: "Route not found" }); return; }
    const authorized = req as AuthorizedRequest;
    if (authorized.authorization.role !== "OWNER" && authorized.authorization.role !== "ADMIN") { res.status(403).json({ message: "Forbidden." }); return; }
    try { if ((await service.resolveCurrent()).sellerId !== authorized.tenant.sellerId) { res.status(403).json({ message: "Forbidden." }); return; } next(); }
    catch (error) { safeError(res, error); }
  };
  router.get("/status", authenticate, authorize, ensureDevelopmentMember, async (_req, res) => {
    try { res.status(200).json(await service.getReadiness()); } catch (error) { safeError(res, error); }
  });
  router.post("/reset-conversation", authenticate, authorize,
    rateLimitAuth(auth.authRateLimiter, "development_tenant_reset", (req) => (req as Partial<{ auth?: { userId?: string } }>).auth?.userId ?? req.ip, { issueCode: "RATE_LIMITED" }),
    ensureDevelopmentMember, async (req, res) => {
      try {
        if (!isEmptyBody(req)) return res.status(400).json({ issueCode: "RESET_REQUEST_INVALID" });
        const result = await new DevelopmentTenantConversationResetService(service, getValkeyClient()).executeTrustedReset();
        console.info(JSON.stringify({ event: "development_tenant_conversation_reset", deletedEphemeralKeyCount: result.deletedKeyCount }));
        res.status(200).json({ success: true, status: "RESET_COMPLETED", deletedConversationStateKeys: result.deletedKeyCount, deletedKeyCount: result.deletedKeyCount });
      } catch (error) { safeError(res, error); }
    });
  return router;
}
