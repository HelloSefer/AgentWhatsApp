export class SellerWorkspaceProfileValidationError extends Error {
  constructor() {
    super("Seller workspace profile input is invalid.");
    this.name = "SellerWorkspaceProfileValidationError";
  }
}

export class SellerWorkspaceProfileAlreadyExistsError extends Error {
  constructor() {
    super("Seller workspace profile already exists.");
    this.name = "SellerWorkspaceProfileAlreadyExistsError";
  }
}

export class SellerWorkspaceProfileSellerNotFoundError extends Error {
  constructor() {
    super("The seller for this workspace profile was not found.");
    this.name = "SellerWorkspaceProfileSellerNotFoundError";
  }
}

export class SellerWorkspaceProfilePersistenceError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("Seller workspace profile persistence failed.");
    this.name = "SellerWorkspaceProfilePersistenceError";
    this.cause = cause;
  }
}
