import type { Request, Response } from "express";
import type { AccountRecoveryService } from "../application/account-recovery.service";
import type { SessionAuthService } from "../application/session-auth.service";
import { clearAuthCookie, readAuthCookie, setAuthCookie } from "./auth-cookie";
import { sendAuthError } from "./auth-http.errors";
import type { AuthenticatedRequest } from "./auth-request.types";

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export class AuthController {
  constructor(
    private readonly sessionAuthService: SessionAuthService,
    private readonly accountRecoveryService: AccountRecoveryService,
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

  login = async (req: Request, res: Response): Promise<Response | void> => {
    try {
      const result = await this.sessionAuthService.login({
        email: stringField(req.body?.email),
        password: stringField(req.body?.password),
      });
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
