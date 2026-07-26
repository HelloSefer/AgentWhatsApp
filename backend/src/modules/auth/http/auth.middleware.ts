import type { NextFunction, Request, Response } from "express";
import type { SessionAuthService } from "../application/session-auth.service";
import { readAuthCookie } from "./auth-cookie";

export function authenticateRequest(sessionAuthService: SessionAuthService) {
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
