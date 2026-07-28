import type { NextFunction, Request, Response } from "express";
import { isTrustedOrigin, requestHasAuthCookie } from "./trusted-origin";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function excludedPath(path: string): boolean {
  return path === "/health" ||
    path.startsWith("/health/") ||
    path.startsWith("/api/database/health") ||
    path.startsWith("/api/whatsapp/cloud/webhook") ||
    path.startsWith("/api/whatsapp/webhooks/connections") ||
    path.startsWith("/api/auth/google/callback");
}

export function csrfOriginProtection(req: Request, res: Response, next: NextFunction): void {
  if (!UNSAFE_METHODS.has(req.method) || excludedPath(req.path)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (origin !== undefined && !isTrustedOrigin(origin)) {
    res.status(403).json({ message: "Forbidden." });
    return;
  }

  const referer = req.headers.referer;
  if (origin === undefined && requestHasAuthCookie(req) && referer !== undefined) {
    try {
      if (!isTrustedOrigin(new URL(referer).origin)) {
        res.status(403).json({ message: "Forbidden." });
        return;
      }
    } catch {
      res.status(403).json({ message: "Forbidden." });
      return;
    }
  }

  next();
}
