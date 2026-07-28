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

export class WhatsAppConnectionFinalizationValidationError extends Error {
  constructor() {
    super("WhatsApp connection finalization input is invalid.");
    this.name = "WhatsAppConnectionFinalizationValidationError";
  }
}

export class WhatsAppConnectionFinalizationConflictError extends Error {
  constructor() {
    super("WhatsApp connection finalization conflicts with existing state.");
    this.name = "WhatsAppConnectionFinalizationConflictError";
  }
}

export class WhatsAppConnectionFinalizationAccessDeniedError extends Error {
  constructor() {
    super("WhatsApp connection finalization is not authorized.");
    this.name = "WhatsAppConnectionFinalizationAccessDeniedError";
  }
}

export class WhatsAppConnectionFinalizationVerificationError extends Error {
  constructor() {
    super("WhatsApp connection finalization could not be verified.");
    this.name = "WhatsAppConnectionFinalizationVerificationError";
  }
}

export class WhatsAppConnectionFinalizationRetryableError extends Error {
  constructor() {
    super("WhatsApp connection finalization can be retried.");
    this.name = "WhatsAppConnectionFinalizationRetryableError";
  }
}

export class WhatsAppConnectionDisconnectValidationError extends Error {
  constructor() {
    super("WhatsApp connection disconnect input is invalid.");
    this.name = "WhatsAppConnectionDisconnectValidationError";
  }
}

export class WhatsAppConnectionDisconnectConflictError extends Error {
  constructor() {
    super("WhatsApp connection disconnect conflicts with existing state.");
    this.name = "WhatsAppConnectionDisconnectConflictError";
  }
}

export class WhatsAppConnectionDisconnectAccessDeniedError extends Error {
  constructor() {
    super("WhatsApp connection disconnect is not authorized.");
    this.name = "WhatsAppConnectionDisconnectAccessDeniedError";
  }
}

export type ManualConnectionValidationIssueCode =
  | "META_APP_CREDENTIALS_INVALID"
  | "META_TOKEN_INVALID"
  | "META_TOKEN_EXPIRED"
  | "META_TOKEN_APP_MISMATCH"
  | "META_TOKEN_TYPE_UNSUPPORTED"
  | "META_PERMISSION_MISSING"
  | "META_WABA_ACCESS_MISSING"
  | "META_ASSET_DISCOVERY_FAILED";

export type ManualWebhookIssueCode =
  | "WEBHOOK_PUBLIC_URL_INVALID"
  | "WEBHOOK_VERIFICATION_FAILED"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "WEBHOOK_SUBSCRIPTION_FAILED"
  | "WEBHOOK_SUBSCRIPTION_UNCONFIRMED"
  | "WEBHOOK_PAYLOAD_INVALID"
  | "WEBHOOK_CONNECTION_MISMATCH"
  | "META_PERMISSION_MISSING"
  | "META_TRANSIENT_FAILURE";

export class ManualConnectionValidationError extends Error {
  constructor(readonly issueCode: ManualConnectionValidationIssueCode) {
    super("Manual WhatsApp connection validation failed.");
    this.name = "ManualConnectionValidationError";
  }
}

export class ManualWebhookConfigurationError extends Error {
  constructor(readonly issueCode: ManualWebhookIssueCode) {
    super("Manual WhatsApp webhook configuration failed.");
    this.name = "ManualWebhookConfigurationError";
  }
}
