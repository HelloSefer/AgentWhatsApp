export class WhatsAppConnectionPersistenceError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("WhatsApp connection persistence failed.");
    this.name = "WhatsAppConnectionPersistenceError";
    this.cause = cause;
  }
}

export class WhatsAppConnectionValidationError extends Error {
  constructor() {
    super("WhatsApp connection input is invalid.");
    this.name = "WhatsAppConnectionValidationError";
  }
}

export class WhatsAppConnectionSellerNotFoundError extends Error {
  constructor() {
    super("WhatsApp connection seller was not found.");
    this.name = "WhatsAppConnectionSellerNotFoundError";
  }
}

export class WhatsAppConnectionActiveAlreadyExistsError extends Error {
  constructor() {
    super("Seller already has an active WhatsApp connection.");
    this.name = "WhatsAppConnectionActiveAlreadyExistsError";
  }
}

export class WhatsAppConnectionPhoneNumberAlreadyAssignedError extends Error {
  constructor() {
    super("WhatsApp phone number id is already assigned.");
    this.name = "WhatsAppConnectionPhoneNumberAlreadyAssignedError";
  }
}
