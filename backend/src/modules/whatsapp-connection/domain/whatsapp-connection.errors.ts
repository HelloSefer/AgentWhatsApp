export class WhatsAppConnectionPersistenceError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("WhatsApp connection persistence failed.");
    this.name = "WhatsAppConnectionPersistenceError";
    this.cause = cause;
  }
}

/** Deliberately does not carry a connection or tenant identifier. */
export class WhatsAppConnectionNotFoundError extends Error {
  constructor() {
    super("WhatsApp connection was not found.");
    this.name = "WhatsAppConnectionNotFoundError";
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

/**
 * The manual setup route was composed without a usable credential-encryption
 * dependency.  This is deliberately distinct from a cryptographic operation
 * failure so the HTTP boundary can return a bounded, actionable-safe code.
 */
export class ManualConnectionSetupEncryptionUnavailableError extends WhatsAppConnectionCredentialEncryptionError {
  constructor() {
    super();
    this.name = "ManualConnectionSetupEncryptionUnavailableError";
  }
}

export class WhatsAppConnectionMetaConfigurationError extends Error {
  constructor() {
    super("Meta Embedded Signup configuration is unavailable.");
    this.name = "WhatsAppConnectionMetaConfigurationError";
  }
}

export type WhatsAppConnectionMetaTransportCode =
  | "configuration"
  | "auth"
  | "not_found"
  | "validation"
  | "unavailable";

export type WhatsAppConnectionMetaOperation =
  | "acquire_app_access_token"
  | "inspect_system_user_token"
  | "list_assigned_wabas"
  | "read_waba"
  | "list_waba_phone_numbers"
  | "read_phone_number"
  | "subscribe_waba"
  | "list_waba_subscriptions"
  | "set_phone_two_step_verification_pin"
  | "register_phone_number"
  | "read_phone_registration_status";

export type WhatsAppConnectionMetaTransportDiagnostics = Readonly<{
  operation?: WhatsAppConnectionMetaOperation;
  httpStatus?: number | null;
  metaErrorCode?: number | null;
  metaErrorSubcode?: number | null;
}>;

export class WhatsAppConnectionMetaTransportError extends Error {
  readonly operation: WhatsAppConnectionMetaOperation | null;
  readonly httpStatus: number | null;
  readonly metaErrorCode: number | null;
  readonly metaErrorSubcode: number | null;

  constructor(
    readonly code: WhatsAppConnectionMetaTransportCode,
    diagnostics: WhatsAppConnectionMetaTransportDiagnostics = {},
  ) {
    super("Meta Embedded Signup transport failed.");
    this.name = "WhatsAppConnectionMetaTransportError";
    this.operation = diagnostics.operation ?? null;
    this.httpStatus = typeof diagnostics.httpStatus === "number"
      && Number.isInteger(diagnostics.httpStatus)
      && diagnostics.httpStatus >= 100
      && diagnostics.httpStatus <= 599
      ? diagnostics.httpStatus
      : null;
    this.metaErrorCode = typeof diagnostics.metaErrorCode === "number"
      && Number.isSafeInteger(diagnostics.metaErrorCode)
      && diagnostics.metaErrorCode >= 0
      && diagnostics.metaErrorCode <= 2_147_483_647
      ? diagnostics.metaErrorCode
      : null;
    this.metaErrorSubcode = typeof diagnostics.metaErrorSubcode === "number"
      && Number.isSafeInteger(diagnostics.metaErrorSubcode)
      && diagnostics.metaErrorSubcode >= 0
      && diagnostics.metaErrorSubcode <= 2_147_483_647
      ? diagnostics.metaErrorSubcode
      : null;
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

export class ManualConnectionCredentialReplacementForbiddenError extends Error {
  readonly issueCode = "MANUAL_CONNECTION_CREDENTIAL_REPLACEMENT_FORBIDDEN" as const;

  constructor() {
    super("Active manual WhatsApp connection credentials cannot be replaced.");
    this.name = "ManualConnectionCredentialReplacementForbiddenError";
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
  | "META_APP_SECRET_INVALID"
  | "META_APP_ACCESS_TOKEN_INVALID"
  | "META_APP_CREDENTIAL_MISMATCH"
  | "META_TOKEN_INVALID"
  | "META_TOKEN_EXPIRED"
  | "META_TOKEN_APP_MISMATCH"
  | "META_TOKEN_TYPE_UNSUPPORTED"
  | "META_TOKEN_TYPE_INVALID"
  | "META_PERMISSION_MISSING"
  | "META_REQUIRED_PERMISSION_MISSING"
  | "META_WABA_ACCESS_MISSING"
  | "META_WABA_ACCESS_DENIED"
  | "META_WABA_NOT_FOUND"
  | "META_PHONE_ACCESS_DENIED"
  | "META_PHONE_NOT_FOUND"
  | "META_PHONE_WABA_MISMATCH"
  | "META_GRAPH_REQUEST_REJECTED"
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

export type ManualFinalizationIssueCode =
  | "MANUAL_CONNECTION_NOT_READY"
  | "META_TOKEN_INVALID"
  | "META_TOKEN_EXPIRED"
  | "META_TOKEN_APP_MISMATCH"
  | "META_PERMISSION_MISSING"
  | "META_WABA_ACCESS_MISSING"
  | "META_PHONE_ACCESS_MISSING"
  | "META_PHONE_REGISTRATION_FAILED"
  | "WEBHOOK_NOT_CONFIGURED"
  | "WEBHOOK_SUBSCRIPTION_UNCONFIRMED"
  | "WEBHOOK_PUBLIC_URL_INVALID"
  | "CONNECTION_ACTIVATION_CONFLICT"
  | "META_TRANSIENT_FAILURE";

export class ManualConnectionValidationError extends Error {
  constructor(readonly issueCode: ManualConnectionValidationIssueCode) {
    super("Manual WhatsApp connection validation failed.");
    this.name = "ManualConnectionValidationError";
  }
}

export function manualMetaTransportIssueCode(
  error: WhatsAppConnectionMetaTransportError,
  operationHint?: WhatsAppConnectionMetaOperation,
): ManualConnectionValidationIssueCode {
  const operation = error.operation ?? operationHint;
  if (operation === "acquire_app_access_token") {
    if (error.code === "auth" || error.code === "validation") return "META_APP_SECRET_INVALID";
    if (error.code === "configuration") return "META_APP_ACCESS_TOKEN_INVALID";
    return "META_GRAPH_REQUEST_REJECTED";
  }
  if (operation === "inspect_system_user_token") {
    if (
      error.metaErrorCode === 190 ||
      error.httpStatus === 401 ||
      error.httpStatus === 403 ||
      error.code === "auth"
    ) {
      return "META_APP_ACCESS_TOKEN_INVALID";
    }
    return "META_GRAPH_REQUEST_REJECTED";
  }
  if (error.metaErrorCode === 190 || error.httpStatus === 401) return "META_TOKEN_INVALID";
  const permissionDenied = error.metaErrorCode === 10 || error.metaErrorCode === 200;
  if (operation === "list_assigned_wabas") return "META_ASSET_DISCOVERY_FAILED";
  if (operation === "read_waba") {
    if (error.code === "not_found" || error.httpStatus === 404) return "META_WABA_NOT_FOUND";
    if (permissionDenied || error.code === "auth" || error.httpStatus === 403) return "META_WABA_ACCESS_DENIED";
    return "META_GRAPH_REQUEST_REJECTED";
  }
  if (operation === "list_waba_phone_numbers" || operation === "read_phone_number") {
    if (error.code === "not_found" || error.httpStatus === 404) return "META_PHONE_NOT_FOUND";
    if (permissionDenied || error.code === "auth" || error.httpStatus === 403) return "META_PHONE_ACCESS_DENIED";
    return "META_GRAPH_REQUEST_REJECTED";
  }
  return error.code === "auth" ? "META_TOKEN_INVALID" : "META_GRAPH_REQUEST_REJECTED";
}

export class ManualWebhookConfigurationError extends Error {
  constructor(readonly issueCode: ManualWebhookIssueCode) {
    super("Manual WhatsApp webhook configuration failed.");
    this.name = "ManualWebhookConfigurationError";
  }
}

export class ManualFinalizationError extends Error {
  constructor(readonly issueCode: ManualFinalizationIssueCode) {
    super("Manual WhatsApp connection finalization failed.");
    this.name = "ManualFinalizationError";
  }
}
