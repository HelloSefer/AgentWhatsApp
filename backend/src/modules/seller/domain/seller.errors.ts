export class SellerDomainError extends Error {
  readonly publicMessage: string;
  readonly cause?: unknown;

  constructor(publicMessage: string, cause?: unknown) {
    super(publicMessage);
    this.name = "SellerDomainError";
    this.publicMessage = publicMessage;
    this.cause = cause;
  }
}

export class SellerValidationError extends SellerDomainError {
  constructor() {
    super("Seller identity is invalid.");
    this.name = "SellerValidationError";
  }
}

export class SellerAlreadyExistsError extends SellerDomainError {
  constructor() {
    super("Seller already exists.");
    this.name = "SellerAlreadyExistsError";
  }
}

export class SellerPersistenceError extends SellerDomainError {
  constructor(cause?: unknown) {
    super("Seller persistence is unavailable.", cause);
    this.name = "SellerPersistenceError";
  }
}
