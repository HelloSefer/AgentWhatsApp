import type { Response } from "express";
import { AuthRateLimitExceededError } from "../../auth";
import {
  AuthorizationForbiddenError,
  AuthorizationInsufficientPermissionError,
  AuthorizationTenantSelectionRequiredError,
  AuthorizationUnauthenticatedError,
} from "../../auth/application/authorization.errors";
import {
  ManualConnectionCredentialReplacementForbiddenError,
  ManualConnectionValidationError,
  ManualFinalizationError,
  ManualWebhookConfigurationError,
  ManualConnectionSetupEncryptionUnavailableError,
  WhatsAppConnectionCompletionAccessDeniedError,
  WhatsAppConnectionCompletionConflictError,
  WhatsAppConnectionCompletionValidationError,
  WhatsAppConnectionCompletionVerificationError,
  WhatsAppConnectionCredentialEncryptionError,
  WhatsAppConnectionDisconnectAccessDeniedError,
  WhatsAppConnectionDisconnectConflictError,
  WhatsAppConnectionDisconnectValidationError,
  WhatsAppConnectionFinalizationAccessDeniedError,
  WhatsAppConnectionFinalizationConflictError,
  WhatsAppConnectionFinalizationRetryableError,
  WhatsAppConnectionFinalizationValidationError,
  WhatsAppConnectionFinalizationVerificationError,
  WhatsAppConnectionMetaConfigurationError,
  WhatsAppConnectionNotFoundError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionValidationError,
} from "../domain/whatsapp-connection.errors";
import { ProductNotFoundError } from "../../catalog/domain/catalog.errors";
import { WhatsAppConnectionProductBindingHttpValidationError } from "./whatsapp-connection-product-binding.request";

export function sendWhatsAppConnectionProductBindingValidationError(
  res: Response,
  issues: readonly Readonly<{ field: string; code: string }>[],
): Response {
  return res.status(400).json({ message: "Invalid product binding request.", errors: issues });
}

export function sendWhatsappConnectionError(res: Response, error: unknown): Response {
  if (error instanceof WhatsAppConnectionProductBindingHttpValidationError) {
    return sendWhatsAppConnectionProductBindingValidationError(res, error.issues);
  }
  if (error instanceof AuthRateLimitExceededError) {
    res.setHeader("Retry-After", String(error.retryAfterSeconds));
    return res.status(429).json({ message: "Too many requests. Please try again later." });
  }
  if (error instanceof AuthorizationUnauthenticatedError) return res.status(401).json({ message: "Authentication required." });
  if (error instanceof AuthorizationForbiddenError || error instanceof AuthorizationInsufficientPermissionError) return res.status(403).json({ message: "Forbidden." });
  if (error instanceof AuthorizationTenantSelectionRequiredError) return res.status(409).json({ message: "Seller selection required." });
  if (error instanceof WhatsAppConnectionNotFoundError) return res.status(404).json({ message: "WhatsApp connection not found." });
  if (error instanceof ProductNotFoundError) return res.status(404).json({ message: "Product not found." });
  if (error instanceof WhatsAppConnectionValidationError) return res.status(400).json({ message: "Invalid request." });
  if (error instanceof ManualConnectionCredentialReplacementForbiddenError) {
    return res.status(409).json({
      message: "Active WhatsApp connection credentials cannot be replaced.",
      issueCode: error.issueCode,
    });
  }
  if (error instanceof ManualConnectionValidationError) return res.status(400).json({ message: "WhatsApp connection could not be validated.", issueCode: error.issueCode });
  if (error instanceof ManualWebhookConfigurationError) return res.status(400).json({ message: "WhatsApp webhook could not be configured.", issueCode: error.issueCode });
  if (error instanceof ManualFinalizationError) return res.status(400).json({ message: "WhatsApp connection could not be finalized.", issueCode: error.issueCode });
  if (error instanceof WhatsAppConnectionCompletionValidationError) return res.status(400).json({ message: "Invalid request." });
  if (error instanceof WhatsAppConnectionCompletionAccessDeniedError) return res.status(403).json({ message: "WhatsApp connection could not be verified." });
  if (error instanceof WhatsAppConnectionCompletionConflictError) return res.status(409).json({ message: "WhatsApp connection could not be completed safely." });
  if (error instanceof WhatsAppConnectionCompletionVerificationError) return res.status(400).json({ message: "WhatsApp connection could not be verified." });
  if (error instanceof WhatsAppConnectionFinalizationValidationError) return res.status(400).json({ message: "Invalid request." });
  if (error instanceof WhatsAppConnectionFinalizationAccessDeniedError) return res.status(403).json({ message: "WhatsApp connection could not be finalized." });
  if (error instanceof WhatsAppConnectionFinalizationConflictError) return res.status(409).json({ message: "WhatsApp connection could not be finalized safely." });
  if (error instanceof WhatsAppConnectionFinalizationRetryableError) return res.status(503).json({ message: "WhatsApp connection finalization can be retried." });
  if (error instanceof WhatsAppConnectionFinalizationVerificationError) return res.status(400).json({ message: "WhatsApp connection could not be finalized." });
  if (error instanceof WhatsAppConnectionDisconnectValidationError) return res.status(400).json({ message: "Invalid request." });
  if (error instanceof WhatsAppConnectionDisconnectAccessDeniedError) return res.status(403).json({ message: "WhatsApp connection could not be disconnected." });
  if (error instanceof WhatsAppConnectionDisconnectConflictError) return res.status(409).json({ message: "WhatsApp connection could not be disconnected safely." });
  if (error instanceof WhatsAppConnectionMetaConfigurationError) return res.status(503).json({ message: "WhatsApp connection is not configured." });
  if (error instanceof ManualConnectionSetupEncryptionUnavailableError) {
    return res.status(500).json({
      message: "WhatsApp connection service unavailable.",
      issueCode: "WHATSAPP_CREDENTIAL_ENCRYPTION_UNAVAILABLE",
    });
  }
  if (error instanceof WhatsAppConnectionCredentialEncryptionError || error instanceof WhatsAppConnectionPersistenceError) return res.status(500).json({ message: "WhatsApp connection service unavailable." });
  return res.status(500).json({ message: "WhatsApp connection service unavailable." });
}
