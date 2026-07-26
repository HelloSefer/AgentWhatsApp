import { AuthServiceError } from "../services/auth-service";

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof AuthServiceError)) {
    return "Authentication is temporarily unavailable. Please try again shortly.";
  }

  if (error.code === "invalid_credentials") return "The email or password you entered is incorrect.";
  if (error.code === "email_exists") return "An account already exists for this email.";
  if (error.code === "invalid_token") return "This link is invalid, expired, or has already been used.";
  return error.message;
}
