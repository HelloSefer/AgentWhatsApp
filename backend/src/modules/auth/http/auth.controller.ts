import type { Request, Response } from "express";
import type { AccountRecoveryService } from "../application/account-recovery.service";
import type { AuthRateLimiter } from "../application/auth-rate-limiter";
import type { GoogleAuthService } from "../application/google-auth.service";
import type { SessionAuthService } from "../application/session-auth.service";
import { clearAuthCookie, readAuthCookie, setAuthCookie } from "./auth-cookie";
import { sendAuthError } from "./auth-http.errors";
import type { AuthenticatedRequest } from "./auth-request.types";
import { clearGoogleOAuthCookies, readGoogleOAuthCookies, setGoogleOAuthCookies } from "./google-oauth-cookies";

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export class AuthController {
  constructor(
    private readonly sessionAuthService: SessionAuthService,
    private readonly accountRecoveryService: AccountRecoveryService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly authRateLimiter: AuthRateLimiter,
  ) {}

  signup = async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const result = await this.sessionAuthService.signup({
        email: stringField(req.body?.email),
        password: stringField(req.body?.password),
      });
      setAuthCookie(res, result.session.rawToken);
      return res.status(201).json({
        user: result.user,
        activeMemberships: result.activeMemberships,
        needsOnboarding: result.needsOnboarding,
      });
    } catch (error) {
      return sendAuthError(res, error);
    }
  };

  googleStart = async (_req: Request, res: Response): Promise<Response | void> => {
    try {
      const result = this.googleAuthService.start();
      setGoogleOAuthCookies(res, result);
      return res.redirect(302, result.authorizationUrl);
    } catch (error) {
      clearGoogleOAuthCookies(res);
      return sendAuthError(res, error);
    }
  };

  googleCallback = async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const result = await this.googleAuthService.callback({
        code: stringField(req.query.code),
        state: stringField(req.query.state),
        ...readGoogleOAuthCookies(req),
      });
      setAuthCookie(res, result.session.rawToken);
      clearGoogleOAuthCookies(res);
      return res.redirect(302, result.redirectUrl);
    } catch (error) {
      clearGoogleOAuthCookies(res);
      return sendAuthError(res, error);
    }
  };

  login = async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const result = await this.sessionAuthService.login({
        email: stringField(req.body?.email),
        password: stringField(req.body?.password),
      });
      await this.authRateLimiter.clear({ action: "login", ip: req.ip, identifier: stringField(req.body?.email) });
      setAuthCookie(res, result.session.rawToken);
      return res.status(200).json({
        user: result.user,
        activeMemberships: result.activeMemberships,
        needsOnboarding: result.needsOnboarding,
      });
    } catch (error) {
      return sendAuthError(res, error);
    }
  };

  logout = async (req: Request, res: Response): Promise<Response | void> => {
    try {
      await this.sessionAuthService.logout(readAuthCookie(req.headers.cookie));
      clearAuthCookie(res);
      return res.status(204).send();
    } catch (error) {
      clearAuthCookie(res);
      return sendAuthError(res, error);
    }
  };

  me = async (req: Request, res: Response): Promise<Response> => {
    const auth = (req as AuthenticatedRequest).auth;
    return res.status(200).json({
      user: auth.user,
      activeMemberships: auth.activeMemberships,
      needsOnboarding: auth.needsOnboarding,
    });
  };

  requestEmailVerification = async (req: Request, res: Response): Promise<Response> => {
    try {
      await this.accountRecoveryService.requestEmailVerification({ email: stringField(req.body?.email) });
      return res.status(202).json({ accepted: true });
    } catch (error) {
      return sendAuthError(res, error);
    }
  };

  confirmEmailVerification = async (req: Request, res: Response): Promise<Response> => {
    try {
      await this.accountRecoveryService.confirmEmailVerification({ token: stringField(req.body?.token) });
      return res.status(200).json({ completed: true });
    } catch (error) {
      return sendAuthError(res, error);
    }
  };

  requestPasswordReset = async (req: Request, res: Response): Promise<Response> => {
    try {
      await this.accountRecoveryService.requestPasswordReset({ email: stringField(req.body?.email) });
      return res.status(202).json({ accepted: true });
    } catch (error) {
      return sendAuthError(res, error);
    }
  };

  confirmPasswordReset = async (req: Request, res: Response): Promise<Response> => {
    try {
      await this.accountRecoveryService.confirmPasswordReset({
        token: stringField(req.body?.token),
        newPassword: stringField(req.body?.newPassword),
      });
      return res.status(200).json({ completed: true });
    } catch (error) {
      return sendAuthError(res, error);
    }
  };
}
