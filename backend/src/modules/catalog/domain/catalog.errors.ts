export class CatalogValidationError extends Error {
  constructor() {
    super("Catalog input is invalid.");
    this.name = "CatalogValidationError";
  }
}

export class ProductAlreadyExistsError extends Error {
  constructor() {
    super("A product with this identifier already exists for the seller.");
    this.name = "ProductAlreadyExistsError";
  }
}

export class CatalogSellerNotFoundError extends Error {
  constructor() {
    super("The catalog seller was not found.");
    this.name = "CatalogSellerNotFoundError";
  }
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("The product was not found.");
    this.name = "ProductNotFoundError";
  }
}

export class CatalogPersistenceError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("Catalog persistence failed.");
    this.name = "CatalogPersistenceError";
    this.cause = cause;
  }
}
