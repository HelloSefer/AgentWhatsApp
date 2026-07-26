export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthorizationUnauthenticatedError extends AuthorizationError {
  constructor() {
    super("Authentication is required.");
    this.name = "AuthorizationUnauthenticatedError";
  }
}

export class AuthorizationForbiddenError extends AuthorizationError {
  constructor() {
    super("Access is forbidden.");
    this.name = "AuthorizationForbiddenError";
  }
}

export class AuthorizationNoActiveMembershipError extends AuthorizationForbiddenError {
  constructor() {
    super();
    this.name = "AuthorizationNoActiveMembershipError";
  }
}

export class AuthorizationTenantSelectionRequiredError extends AuthorizationForbiddenError {
  constructor() {
    super();
    this.name = "AuthorizationTenantSelectionRequiredError";
  }
}

export class AuthorizationInvalidSellerTargetError extends AuthorizationForbiddenError {
  constructor() {
    super();
    this.name = "AuthorizationInvalidSellerTargetError";
  }
}

export class AuthorizationInsufficientPermissionError extends AuthorizationForbiddenError {
  constructor() {
    super();
    this.name = "AuthorizationInsufficientPermissionError";
  }
}
