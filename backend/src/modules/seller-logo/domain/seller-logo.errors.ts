export class SellerLogoValidationError extends Error {
  constructor() {
    super("Seller logo input is invalid.");
    this.name = "SellerLogoValidationError";
  }
}

export class SellerLogoProfileNotFoundError extends Error {
  constructor() {
    super("Seller workspace profile was not found.");
    this.name = "SellerLogoProfileNotFoundError";
  }
}

export class SellerLogoStorageError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("Seller logo storage failed.");
    this.name = "SellerLogoStorageError";
    this.cause = cause;
  }
}

export class SellerLogoPersistenceError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("Seller logo metadata persistence failed.");
    this.name = "SellerLogoPersistenceError";
    this.cause = cause;
  }
}
