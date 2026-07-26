export class AuthDomainError extends Error {
  readonly publicMessage: string;
  readonly cause?: unknown;

  constructor(publicMessage: string, cause?: unknown) {
    super(publicMessage);
    this.name = "AuthDomainError";
    this.publicMessage = publicMessage;
    this.cause = cause;
  }
}

export class AuthValidationError extends AuthDomainError {
  constructor() {
    super("Auth input is invalid.");
    this.name = "AuthValidationError";
  }
}

export class AuthAlreadyExistsError extends AuthDomainError {
  constructor() {
    super("Auth record already exists.");
    this.name = "AuthAlreadyExistsError";
  }
}

export class AuthInvalidCredentialsError extends AuthDomainError {
  constructor() {
    super("Email or password is invalid.");
    this.name = "AuthInvalidCredentialsError";
  }
}

export class AuthInvalidTokenError extends AuthDomainError {
  constructor() {
    super("Auth token is invalid or expired.");
    this.name = "AuthInvalidTokenError";
  }
}

export class AuthEmailDeliveryError extends AuthDomainError {
  constructor(cause?: unknown) {
    super("Auth email delivery failed.", cause);
    this.name = "AuthEmailDeliveryError";
  }
}

export class AuthNotFoundError extends AuthDomainError {
  constructor() {
    super("Auth record was not found.");
    this.name = "AuthNotFoundError";
  }
}

export class AuthPersistenceError extends AuthDomainError {
  constructor(cause?: unknown) {
    super("Auth persistence is unavailable.", cause);
    this.name = "AuthPersistenceError";
  }
}
