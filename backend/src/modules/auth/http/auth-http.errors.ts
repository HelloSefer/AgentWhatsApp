import type { Response } from "express";
import {
  AuthAlreadyExistsError,
  AuthEmailDeliveryError,
  AuthInvalidCredentialsError,
  AuthInvalidTokenError,
  AuthValidationError,
} from "../domain/auth.errors";
import { GoogleAuthUnavailableError } from "../application/google-auth.service";

export function sendAuthError(res: Response, error: unknown): Response {
  if (error instanceof AuthValidationError) return res.status(400).json({ message: "Invalid request." });
  if (error instanceof AuthAlreadyExistsError) return res.status(409).json({ message: "Email already exists." });
  if (error instanceof AuthInvalidCredentialsError) return res.status(401).json({ message: "Authentication failed." });
  if (error instanceof AuthInvalidTokenError) return res.status(400).json({ message: "Invalid or expired token." });
  if (error instanceof AuthEmailDeliveryError) return res.status(503).json({ message: "Email delivery failed." });
  if (error instanceof GoogleAuthUnavailableError) return res.status(503).json({ message: "Google authentication is unavailable." });
  return res.status(500).json({ message: "Authentication service unavailable." });
}
