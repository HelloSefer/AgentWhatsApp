import type { NextFunction, Request, Response } from "express";
import type { AuthRateLimitAction, AuthRateLimiter } from "../application/auth-rate-limiter";
import { AuthRateLimitExceededError } from "../application/auth-rate-limiter";

export function rateLimitAuth(
  rateLimiter: AuthRateLimiter,
  action: AuthRateLimitAction,
  identifier: (req: Request) => unknown = () => undefined,
  options: Readonly<{ issueCode?: string }> = {},
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await rateLimiter.assertAllowed({ action, ip: req.ip, identifier: identifier(req) });
      next();
    } catch (error) {
      if (error instanceof AuthRateLimitExceededError) {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
        res.status(429).json({
          message: "Too many requests. Please try again later.",
          ...(options.issueCode ? { issueCode: options.issueCode, code: options.issueCode } : {}),
        });
        return;
      }
      res.status(503).json({ message: "Authentication rate protection unavailable." });
    }
  };
}
