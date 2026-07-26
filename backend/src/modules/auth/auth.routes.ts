import { Router } from "express";
import { createAuthComposition } from "../../composition/auth/create-auth-composition";
import type { AuthComposition } from "../../composition/auth/auth-composition.types";
import { AuthController } from "./http/auth.controller";
import { authenticateRequest } from "./http/auth.middleware";

export function createAuthRoutes(composition: AuthComposition = createAuthComposition()): Router {
  const router = Router();
  const controller = new AuthController(composition.sessionAuthService, composition.accountRecoveryService, composition.googleAuthService);
  const authenticate = authenticateRequest(composition.sessionAuthService);

  router.get("/google/start", controller.googleStart);
  router.get("/google/callback", controller.googleCallback);
  router.post("/signup", controller.signup);
  router.post("/login", controller.login);
  router.post("/logout", controller.logout);
  router.get("/me", authenticate, controller.me);
  router.post("/email-verification/request", controller.requestEmailVerification);
  router.post("/email-verification/confirm", controller.confirmEmailVerification);
  router.post("/password/forgot", controller.requestPasswordReset);
  router.post("/password/reset", controller.confirmPasswordReset);

  return router;
}

export default createAuthRoutes();
