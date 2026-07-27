export class SellerWorkspaceOnboardingValidationError extends Error {
  constructor() {
    super("Seller workspace onboarding input is invalid.");
    this.name = "SellerWorkspaceOnboardingValidationError";
  }
}

export class SellerWorkspaceOnboardingUserNotFoundError extends Error {
  constructor() {
    super("The authenticated user was not found.");
    this.name = "SellerWorkspaceOnboardingUserNotFoundError";
  }
}

export class SellerWorkspaceOnboardingInactiveUserError extends Error {
  constructor() {
    super("The authenticated user is not active.");
    this.name = "SellerWorkspaceOnboardingInactiveUserError";
  }
}

export class SellerWorkspaceAlreadyOnboardedError extends Error {
  constructor() {
    super("Seller workspace onboarding is already completed.");
    this.name = "SellerWorkspaceAlreadyOnboardedError";
  }
}

export class SellerWorkspaceOnboardingInconsistentStateError extends Error {
  constructor() {
    super("Seller workspace onboarding state is inconsistent.");
    this.name = "SellerWorkspaceOnboardingInconsistentStateError";
  }
}

export class SellerWorkspaceOnboardingPersistenceError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("Seller workspace onboarding persistence failed.");
    this.name = "SellerWorkspaceOnboardingPersistenceError";
    this.cause = cause;
  }
}
