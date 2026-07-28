import { EmbeddedSignupCompletionServiceError } from "../services/embedded-signup-completion-service";

export function whatsappConnectionErrorMessage(error: unknown): string {
  if (error instanceof EmbeddedSignupCompletionServiceError) return error.message;
  return "WhatsApp connection could not be verified. Please try again.";
}
