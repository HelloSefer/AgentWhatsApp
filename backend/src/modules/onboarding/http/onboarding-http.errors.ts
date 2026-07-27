import type { Response } from "express";
import { AuthRateLimitExceededError } from "../../auth";
import { AuthorizationForbiddenError, AuthorizationInsufficientPermissionError, AuthorizationTenantSelectionRequiredError, AuthorizationUnauthenticatedError } from "../../auth/application/authorization.errors";
import {
  SellerLogoPersistenceError,
  SellerLogoProfileNotFoundError,
  SellerLogoStorageError,
  SellerLogoValidationError,
} from "../../seller-logo";
import { SellerWorkspaceProfileValidationError } from "../../seller-workspace-profile";
import {
  SellerWorkspaceOnboardingInactiveUserError,
  SellerWorkspaceOnboardingInconsistentStateError,
  SellerWorkspaceOnboardingPersistenceError,
  SellerWorkspaceOnboardingUserNotFoundError,
  SellerWorkspaceOnboardingValidationError,
} from "../../seller-workspace-onboarding";

export class OnboardingMultipartPayloadTooLargeError extends Error {
  constructor() {
    super("Onboarding multipart payload is too large.");
    this.name = "OnboardingMultipartPayloadTooLargeError";
  }
}

export class OnboardingMultipartValidationError extends Error {
  constructor() {
    super("Onboarding multipart payload is invalid.");
    this.name = "OnboardingMultipartValidationError";
  }
}

export function sendOnboardingError(res: Response, error: unknown): Response {
  if (error instanceof AuthRateLimitExceededError) {
    res.setHeader("Retry-After", String(error.retryAfterSeconds));
    return res.status(429).json({ message: "Too many requests. Please try again later." });
  }
  if (error instanceof AuthorizationUnauthenticatedError) return res.status(401).json({ message: "Authentication required." });
  if (error instanceof AuthorizationForbiddenError || error instanceof AuthorizationInsufficientPermissionError || error instanceof SellerLogoProfileNotFoundError) {
    return res.status(403).json({ message: "Forbidden." });
  }
  if (error instanceof AuthorizationTenantSelectionRequiredError || error instanceof SellerWorkspaceOnboardingInconsistentStateError) {
    return res.status(409).json({ message: "Workspace state is inconsistent." });
  }
  if (
    error instanceof SellerWorkspaceOnboardingValidationError ||
    error instanceof SellerWorkspaceProfileValidationError ||
    error instanceof SellerWorkspaceOnboardingInactiveUserError ||
    error instanceof SellerWorkspaceOnboardingUserNotFoundError ||
    error instanceof SellerLogoValidationError ||
    error instanceof OnboardingMultipartValidationError
  ) {
    return res.status(400).json({ message: "Invalid request." });
  }
  if (error instanceof OnboardingMultipartPayloadTooLargeError) {
    return res.status(413).json({ message: "Image is too large." });
  }
  if (
    error instanceof SellerWorkspaceOnboardingPersistenceError ||
    error instanceof SellerLogoPersistenceError ||
    error instanceof SellerLogoStorageError
  ) {
    return res.status(500).json({ message: "Onboarding service unavailable." });
  }
  return res.status(500).json({ message: "Onboarding service unavailable." });
}
