import { Router } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import type { AuthComposition } from "../../composition/auth/auth-composition.types";
import { AuthController } from "./http/auth.controller";
import { authenticateRequest } from "./http/auth.middleware";
import { rateLimitAuth } from "./http/auth-rate-limit.middleware";
import type { Request } from "express";

export function createAuthRoutes(composition: AuthComposition = createAuthComposition()): Router {
  const router = Router();
  const controller = new AuthController(composition.sessionAuthService, composition.accountRecoveryService, composition.googleAuthService, composition.authRateLimiter);
  const authenticate = authenticateRequest(composition.sessionAuthService);
  const byEmail = (req: Request) => req.body?.email;

  router.get("/google/start", rateLimitAuth(composition.authRateLimiter, "google_start", (req) => req.ip), controller.googleStart);
  router.get("/google/callback", controller.googleCallback);
  router.post("/signup", rateLimitAuth(composition.authRateLimiter, "signup", byEmail), controller.signup);
  router.post("/login", rateLimitAuth(composition.authRateLimiter, "login", byEmail), controller.login);
  router.post("/logout", controller.logout);
  router.get("/me", authenticate, controller.me);
  router.post("/email-verification/request", rateLimitAuth(composition.authRateLimiter, "email_verification_request", byEmail), controller.requestEmailVerification);
  router.post("/email-verification/confirm", controller.confirmEmailVerification);
  router.post("/password/forgot", rateLimitAuth(composition.authRateLimiter, "password_forgot_request", byEmail), controller.requestPasswordReset);
  router.post("/password/reset", controller.confirmPasswordReset);

  return router;
}

export default createAuthRoutes();
