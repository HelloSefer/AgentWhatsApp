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

export class WhatsAppConnectionCredentialEncryptionError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("WhatsApp connection credential encryption failed.");
    this.name = "WhatsAppConnectionCredentialEncryptionError";
    this.cause = cause;
  }
}

export class WhatsAppConnectionMetaConfigurationError extends Error {
  constructor() {
    super("Meta Embedded Signup configuration is unavailable.");
    this.name = "WhatsAppConnectionMetaConfigurationError";
  }
}

export class WhatsAppConnectionMetaTransportError extends Error {
  constructor(readonly code: "configuration" | "auth" | "not_found" | "validation" | "unavailable") {
    super("Meta Embedded Signup transport failed.");
    this.name = "WhatsAppConnectionMetaTransportError";
  }
}

export class WhatsAppConnectionCompletionValidationError extends Error {
  constructor() {
    super("WhatsApp Embedded Signup completion input is invalid.");
    this.name = "WhatsAppConnectionCompletionValidationError";
  }
}

export class WhatsAppConnectionCompletionAccessDeniedError extends Error {
  constructor() {
    super("WhatsApp Embedded Signup completion is not authorized.");
    this.name = "WhatsAppConnectionCompletionAccessDeniedError";
  }
}

export class WhatsAppConnectionCompletionConflictError extends Error {
  constructor() {
    super("WhatsApp Embedded Signup completion conflicts with existing state.");
    this.name = "WhatsAppConnectionCompletionConflictError";
  }
}

export class WhatsAppConnectionCompletionVerificationError extends Error {
  constructor() {
    super("WhatsApp Embedded Signup completion could not be verified.");
    this.name = "WhatsAppConnectionCompletionVerificationError";
  }
}
