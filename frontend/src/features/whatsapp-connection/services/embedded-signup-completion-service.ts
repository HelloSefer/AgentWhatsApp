import { authenticatedBackendFetch, BackendHttpConfigurationError } from "@/lib/backend-http-client";

export type CompleteEmbeddedSignupInput = Readonly<{
  code: string;
  wabaId: string;
  phoneNumberId: string;
}>;

export type EmbeddedSignupCompletionResponse = Readonly<{
  success: boolean;
}>;

export type WhatsAppConnectionStatus =
  | "PENDING"
  | "VERIFYING"
  | "ACTIVE"
  | "REPLACEMENT_PENDING"
  | "ACTION_REQUIRED"
  | "ERROR"
  | "DISCONNECTED"
  | "REVOKED";

export type WhatsAppConnectionMethod = "EMBEDDED_SIGNUP" | "CUSTOMER_OWNED_META_APP" | string;

export type ManualConnectionIssueCode =
  | "RATE_LIMITED"
  | "META_APP_CREDENTIALS_INVALID"
  | "META_APP_SECRET_INVALID"
  | "META_APP_ACCESS_TOKEN_INVALID"
  | "META_APP_CREDENTIAL_MISMATCH"
  | "META_TOKEN_INVALID"
  | "META_TOKEN_EXPIRED"
  | "META_TOKEN_APP_MISMATCH"
  | "META_TOKEN_TYPE_INVALID"
  | "META_TOKEN_TYPE_UNSUPPORTED"
  | "META_PERMISSION_MISSING"
  | "META_REQUIRED_PERMISSION_MISSING"
  | "META_WABA_ACCESS_MISSING"
  | "META_WABA_ACCESS_DENIED"
  | "META_WABA_NOT_FOUND"
  | "META_ASSET_DISCOVERY_FAILED"
  | "META_PHONE_ACCESS_MISSING"
  | "META_PHONE_ACCESS_DENIED"
  | "META_PHONE_NOT_FOUND"
  | "META_PHONE_WABA_MISMATCH"
  | "META_GRAPH_REQUEST_REJECTED"
  | "MANUAL_CONNECTION_NOT_READY"
  | "MANUAL_CONNECTION_CREDENTIAL_REPLACEMENT_FORBIDDEN"
  | "META_PHONE_REGISTRATION_FAILED"
  | "WEBHOOK_NOT_CONFIGURED"
  | "WEBHOOK_SUBSCRIPTION_FAILED"
  | "WEBHOOK_SUBSCRIPTION_UNCONFIRMED"
  | "WEBHOOK_PUBLIC_URL_INVALID"
  | "WEBHOOK_VERIFICATION_FAILED"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "WEBHOOK_PAYLOAD_INVALID"
  | "WEBHOOK_CONNECTION_MISMATCH"
  | "CONNECTION_ACTIVATION_CONFLICT"
  | "META_TRANSIENT_FAILURE"
  | "WHATSAPP_CREDENTIAL_ENCRYPTION_UNAVAILABLE";

export type CurrentWhatsAppConnection = Readonly<{
  connectionId: string;
  status: WhatsAppConnectionStatus;
  connectionMethod: WhatsAppConnectionMethod | null;
  maskedPhoneNumber: string | null;
  verifiedName: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  disconnectedAt: string | null;
  health: string | null;
  issueCode: ManualConnectionIssueCode | null;
  isReplacement: boolean;
  activeConnection: CurrentWhatsAppConnection | null;
  pendingConnection: CurrentWhatsAppConnection | null;
}>;

export type CurrentWhatsAppConnectionResponse = Readonly<{
  connection: CurrentWhatsAppConnection | null;
}>;

export type DisconnectWhatsAppConnectionResponse = Readonly<{
  disconnected: true;
  connection: Readonly<{
    connectionId: string;
    status: "DISCONNECTED";
    disconnectedAt: string | null;
  }>;
}>;

export type WhatsappConnectionErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "validation_failed"
  | ManualConnectionIssueCode
  | "service_unavailable";

export type SafeWhatsappConnectionError = Readonly<{
  code: WhatsappConnectionErrorCode;
  message: string;
  status: number;
  retryAfterSeconds?: number;
}>;

export type ManualSetupInput = Readonly<{
  appId: string;
  appSecret: string;
  systemUserAccessToken: string;
  connectionId?: string;
}>;

export type ValidatedManualSetupCredentials = Readonly<{
  appId: string;
  appSecret: string;
  systemUserAccessToken: string;
}>;

export type ManualSetupCredentialsValidationResult =
  | Readonly<{ valid: true; value: ValidatedManualSetupCredentials }>
  | Readonly<{ valid: false; message: string }>;

export type SafeManualSetup = Readonly<{
  connectionId: string;
  status: WhatsAppConnectionStatus;
  connectionMethod: WhatsAppConnectionMethod;
  appId: string;
}>;

export type DiscoveredWhatsAppPhone = Readonly<{
  wabaId: string;
  phoneNumberId: string;
  maskedPhoneNumber: string | null;
  verifiedName: string | null;
  status: string | null;
  verificationStatus: string | null;
}>;

export type DiscoveredWhatsAppAccount = Readonly<{
  wabaId: string;
  name: string | null;
  status: string | null;
  phones: ReadonlyArray<DiscoveredWhatsAppPhone>;
}>;

export type ManualDiscoveryResult = Readonly<{
  connectionId: string;
  accounts: ReadonlyArray<DiscoveredWhatsAppAccount>;
}>;

export type ManualAssetSelectionInput = Readonly<{
  connectionId: string;
  wabaId: string;
  phoneNumberId: string;
}>;

export type EmbeddedSignupCompletionService = Readonly<{
  complete(input: CompleteEmbeddedSignupInput): Promise<EmbeddedSignupCompletionResponse>;
  loadCurrent(): Promise<CurrentWhatsAppConnectionResponse>;
  disconnect(connectionId: string): Promise<DisconnectWhatsAppConnectionResponse>;
  setupManual(input: ManualSetupInput): Promise<SafeManualSetup>;
  discoverManual(connectionId: string): Promise<ManualDiscoveryResult>;
  selectManualAssets(input: ManualAssetSelectionInput): Promise<CurrentWhatsAppConnectionResponse>;
  configureManualWebhook(connectionId: string): Promise<CurrentWhatsAppConnectionResponse>;
  finalizeManual(connectionId: string): Promise<CurrentWhatsAppConnectionResponse>;
}>;

const CUSTOMER_OWNED_META_APP = "CUSTOMER_OWNED_META_APP";
const MANUAL_CONNECTION_ID_MAX_LENGTH = 64;
const MANUAL_SECRET_MAX_LENGTH = 4096;
const META_APP_ID_PATTERN = /^[0-9]{1,32}$/u;
const QUOTE_OR_LINE_BREAK_PATTERN = /["'\u2018\u2019\u201c\u201d\r\n]/u;
const TOKEN_WHITESPACE_PATTERN = /\s/u;

const ISSUE_MESSAGES: Record<ManualConnectionIssueCode, string> = {
  RATE_LIMITED: "Too many verification attempts. Wait a moment and try again.",
  META_APP_CREDENTIALS_INVALID: "The stored Meta App credentials could not be verified. Update your Meta credentials.",
  META_APP_SECRET_INVALID: "Meta could not verify this App Secret. Copy the current secret from your Meta App.",
  META_APP_ACCESS_TOKEN_INVALID: "Meta could not authenticate this App ID and App Secret.",
  META_APP_CREDENTIAL_MISMATCH: "The App ID, App Secret, and System User token must belong to the same Meta App.",
  META_TOKEN_INVALID: "Meta could not verify this access token.",
  META_TOKEN_EXPIRED: "This Meta access token has expired. Generate a new System User token.",
  META_TOKEN_APP_MISMATCH: "This access token belongs to a different Meta App.",
  META_TOKEN_TYPE_INVALID: "Meta could not confirm this token type. Generate a new System User token.",
  META_TOKEN_TYPE_UNSUPPORTED: "Use a System User access token. Other Meta token types are not supported.",
  META_PERMISSION_MISSING: "The System User is missing a required WhatsApp permission.",
  META_REQUIRED_PERMISSION_MISSING: "The System User token must include both required WhatsApp permissions.",
  META_WABA_ACCESS_MISSING: "No accessible WhatsApp Business Account was found.",
  META_WABA_ACCESS_DENIED: "The System User cannot access this WhatsApp Business Account.",
  META_WABA_NOT_FOUND: "Meta could not find this WhatsApp Business Account.",
  META_ASSET_DISCOVERY_FAILED: "Meta could not list your WhatsApp accounts automatically. Enter your WhatsApp account details.",
  META_PHONE_ACCESS_MISSING: "The selected phone number is no longer accessible.",
  META_PHONE_ACCESS_DENIED: "The System User cannot access this WhatsApp phone number.",
  META_PHONE_NOT_FOUND: "Meta could not find this WhatsApp phone number.",
  META_PHONE_WABA_MISMATCH: "This phone number does not belong to the selected WhatsApp Business Account.",
  META_GRAPH_REQUEST_REJECTED: "Meta rejected the verification request. Check the account details and try again.",
  MANUAL_CONNECTION_NOT_READY: "This WhatsApp connection is not ready to be activated yet.",
  MANUAL_CONNECTION_CREDENTIAL_REPLACEMENT_FORBIDDEN: "These credentials cannot be updated in the connection's current state.",
  META_PHONE_REGISTRATION_FAILED: "Meta could not confirm the WhatsApp phone registration.",
  WEBHOOK_NOT_CONFIGURED: "The secure WhatsApp webhook must be configured before activation.",
  WEBHOOK_SUBSCRIPTION_FAILED: "Meta could not complete the secure webhook connection.",
  WEBHOOK_SUBSCRIPTION_UNCONFIRMED: "Meta has not confirmed the WhatsApp webhook subscription yet.",
  WEBHOOK_PUBLIC_URL_INVALID: "The AgentWhatsApp connection address is not ready.",
  WEBHOOK_VERIFICATION_FAILED: "Meta could not verify the secure WhatsApp webhook.",
  WEBHOOK_SIGNATURE_INVALID: "The WhatsApp webhook signature could not be verified.",
  WEBHOOK_PAYLOAD_INVALID: "The WhatsApp webhook payload could not be verified.",
  WEBHOOK_CONNECTION_MISMATCH: "The webhook does not match this WhatsApp connection.",
  CONNECTION_ACTIVATION_CONFLICT: "This WhatsApp number is already connected elsewhere.",
  META_TRANSIENT_FAILURE: "Meta is temporarily unavailable. Try again shortly.",
  WHATSAPP_CREDENTIAL_ENCRYPTION_UNAVAILABLE: "Secure Meta credential storage is temporarily unavailable.",
};

export class EmbeddedSignupCompletionServiceError extends Error implements SafeWhatsappConnectionError {
  readonly code: WhatsappConnectionErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(error: SafeWhatsappConnectionError) {
    super(error.message);
    this.name = "EmbeddedSignupCompletionServiceError";
    this.code = error.code;
    this.status = error.status;
    this.retryAfterSeconds = error.retryAfterSeconds;
  }
}

export function validateManualSetupCredentials(
  input: Pick<ManualSetupInput, "appId" | "appSecret" | "systemUserAccessToken">,
): ManualSetupCredentialsValidationResult {
  const appId = typeof input.appId === "string" ? input.appId.trim() : "";
  const appSecret = typeof input.appSecret === "string" ? input.appSecret.trim() : "";
  const systemUserAccessToken =
    typeof input.systemUserAccessToken === "string" ? input.systemUserAccessToken.trim() : "";

  if (!appId || !appSecret || !systemUserAccessToken) {
    return { valid: false, message: "Enter the Meta App ID, App Secret, and System User token." };
  }
  if (!META_APP_ID_PATTERN.test(appId)) {
    return { valid: false, message: "Enter a Meta App ID containing 1 to 32 digits." };
  }
  if (appSecret.length > MANUAL_SECRET_MAX_LENGTH) {
    return { valid: false, message: "The Meta App Secret must be 4,096 characters or fewer." };
  }
  if (QUOTE_OR_LINE_BREAK_PATTERN.test(appSecret)) {
    return { valid: false, message: "Paste the Meta App Secret without quotes or line breaks." };
  }
  if (systemUserAccessToken.length > MANUAL_SECRET_MAX_LENGTH) {
    return { valid: false, message: "The System User token must be 4,096 characters or fewer." };
  }
  if (
    QUOTE_OR_LINE_BREAK_PATTERN.test(systemUserAccessToken) ||
    TOKEN_WHITESPACE_PATTERN.test(systemUserAccessToken)
  ) {
    return { valid: false, message: "Paste the System User token without quotes, spaces, or line breaks." };
  }

  return {
    valid: true,
    value: { appId, appSecret, systemUserAccessToken },
  };
}

function invalidManualInput(message: string): never {
  throw new EmbeddedSignupCompletionServiceError({
    code: "validation_failed",
    message,
    status: 400,
  });
}

function invalidManualSuccessResponse(): never {
  throw new EmbeddedSignupCompletionServiceError({
    code: "service_unavailable",
    message: "WhatsApp connection verification returned an invalid response. Please try again.",
    status: 502,
  });
}

export function manualConnectionIssueMessage(code: string | null | undefined): string {
  if (code && code in ISSUE_MESSAGES) return ISSUE_MESSAGES[code as ManualConnectionIssueCode];
  return "WhatsApp setup could not be completed. Check your setup and try again.";
}

function isManualIssueCode(value: unknown): value is ManualConnectionIssueCode {
  return typeof value === "string" && value in ISSUE_MESSAGES;
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function statusOrFallback(value: unknown): WhatsAppConnectionStatus {
  if (
    value === "PENDING" ||
    value === "VERIFYING" ||
    value === "ACTIVE" ||
    value === "REPLACEMENT_PENDING" ||
    value === "ACTION_REQUIRED" ||
    value === "ERROR" ||
    value === "DISCONNECTED" ||
    value === "REVOKED"
  ) {
    return value;
  }
  return "ERROR";
}

function normalizeConnection(value: unknown): CurrentWhatsAppConnection {
  const record = valueAsRecord(value);
  const activeConnection = record.activeConnection ?? record.active_connection;
  const pendingConnection = record.pendingConnection ?? record.pending_connection;
  const issueCode = record.issueCode ?? record.issue_code;

  return {
    connectionId: stringOrNull(record.connectionId ?? record.connection_id ?? record.id) ?? "",
    status: statusOrFallback(record.status),
    connectionMethod: stringOrNull(record.connectionMethod ?? record.connection_method),
    maskedPhoneNumber: stringOrNull(record.maskedPhoneNumber ?? record.masked_phone_number ?? record.phone),
    verifiedName: stringOrNull(record.verifiedName ?? record.verified_name),
    connectedAt: stringOrNull(record.connectedAt ?? record.connected_at),
    lastVerifiedAt: stringOrNull(record.lastVerifiedAt ?? record.last_verified_at),
    disconnectedAt: stringOrNull(record.disconnectedAt ?? record.disconnected_at),
    health: stringOrNull(record.health ?? record.healthStatus ?? record.health_status),
    issueCode: isManualIssueCode(issueCode) ? issueCode : null,
    isReplacement: record.isReplacement === true || record.is_replacement === true,
    activeConnection: activeConnection ? normalizeConnection(activeConnection) : null,
    pendingConnection: pendingConnection ? normalizeConnection(pendingConnection) : null,
  };
}

function normalizeCurrentResponse(value: unknown): CurrentWhatsAppConnectionResponse {
  const record = valueAsRecord(value);
  return { connection: record.connection ? normalizeConnection(record.connection) : null };
}

function errorForStatus(response: Response): SafeWhatsappConnectionError {
  if (response.status === 429) {
    const retryAfterSeconds = retryAfterSecondsFromResponse(response);
    return {
      code: "RATE_LIMITED",
      message: retryAfterSeconds
        ? `Too many verification attempts. Wait ${retryAfterSeconds} seconds and try again.`
        : "Too many verification attempts. Wait a moment and try again.",
      status: response.status,
      retryAfterSeconds,
    };
  }
  if (response.status === 400) {
    return { code: "validation_failed", message: "WhatsApp setup could not be verified. Please check your details and try again.", status: response.status };
  }
  if (response.status === 401) {
    return { code: "unauthenticated", message: "Please sign in again before connecting WhatsApp.", status: response.status };
  }
  if (response.status === 403) {
    return { code: "forbidden", message: "You do not have permission to connect WhatsApp for this workspace.", status: response.status };
  }

  return {
    code: "service_unavailable",
    message: "WhatsApp connection verification is not available yet. Please try again later.",
    status: response.status,
  };
}

function retryAfterSecondsFromResponse(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
}

async function safeErrorForResponse(response: Response): Promise<SafeWhatsappConnectionError> {
  if (response.status === 429) return errorForStatus(response);
  try {
    const body = valueAsRecord(await response.clone().json());
    const issueCode = body.issueCode ?? body.issue_code ?? body.code;
    if (isManualIssueCode(issueCode)) {
      return { code: issueCode, message: manualConnectionIssueMessage(issueCode), status: response.status };
    }
  } catch {
    return errorForStatus(response);
  }

  return errorForStatus(response);
}

async function requestJson<TResponse>(path: string, init: RequestInit): Promise<TResponse> {
  let response: Response;

  try {
    response = await authenticatedBackendFetch(path, init);
  } catch (error) {
    if (error instanceof BackendHttpConfigurationError) {
      throw new EmbeddedSignupCompletionServiceError({
        code: "service_unavailable",
        message: "WhatsApp connection verification is not configured. Set the frontend backend URL and try again.",
        status: 0,
      });
    }
    throw new EmbeddedSignupCompletionServiceError({
      code: "service_unavailable",
      message: "WhatsApp connection verification is not available yet. Please try again later.",
      status: 0,
    });
  }

  if (!response.ok) throw new EmbeddedSignupCompletionServiceError(await safeErrorForResponse(response));
  return response.json() as Promise<TResponse>;
}

function emptyBody(): string {
  return JSON.stringify({});
}

function safeManualSetupFromBackend(value: unknown, input: ManualSetupInput): SafeManualSetup {
  const record = valueAsRecord(value);
  const connection = valueAsRecord(record.connection);
  const connectionId = stringOrNull(connection.connectionId ?? connection.connection_id)?.trim() ?? "";
  const status = connection.status;
  const connectionMethod = stringOrNull(connection.connectionMethod ?? connection.connection_method);
  const appId = stringOrNull(connection.appId ?? connection.app_id)?.trim() ?? "";
  const expectedConnectionId = input.connectionId?.trim() ?? "";
  const expectedAppId = input.appId.trim();

  if (
    !connectionId ||
    connectionId.length > MANUAL_CONNECTION_ID_MAX_LENGTH ||
    status !== "PENDING" ||
    connectionMethod !== CUSTOMER_OWNED_META_APP ||
    !META_APP_ID_PATTERN.test(appId) ||
    appId !== expectedAppId ||
    (expectedConnectionId && connectionId !== expectedConnectionId)
  ) {
    invalidManualSuccessResponse();
  }

  return {
    connectionId,
    status,
    connectionMethod,
    appId,
  };
}

function normalizePhone(value: unknown, wabaId: string): DiscoveredWhatsAppPhone {
  const record = valueAsRecord(value);
  const phoneNumberId = stringOrNull(record.phoneNumberId ?? record.phone_number_id ?? record.id)?.trim() ?? "";
  if (!/^[0-9]{1,32}$/u.test(phoneNumberId)) invalidManualSuccessResponse();

  return {
    wabaId,
    phoneNumberId,
    maskedPhoneNumber: stringOrNull(
      record.maskedPhoneNumber ??
        record.masked_phone_number ??
        record.maskedDisplayPhoneNumber ??
        record.masked_display_phone_number,
    ),
    verifiedName: stringOrNull(record.verifiedName ?? record.verified_name),
    status: stringOrNull(record.status),
    verificationStatus: stringOrNull(
      record.verificationStatus ??
        record.verification_status ??
        record.codeVerificationStatus ??
        record.code_verification_status,
    ),
  };
}

function normalizeAccount(value: unknown): DiscoveredWhatsAppAccount {
  const record = valueAsRecord(value);
  const wabaId = stringOrNull(record.wabaId ?? record.waba_id ?? record.id)?.trim() ?? "";
  const rawPhones = Array.isArray(record.phoneNumbers)
    ? record.phoneNumbers
    : Array.isArray(record.phones)
      ? record.phones
      : null;
  if (!/^[0-9]{1,32}$/u.test(wabaId) || !rawPhones) invalidManualSuccessResponse();

  return {
    wabaId,
    name: stringOrNull(record.name ?? record.safeName ?? record.safe_name),
    status: stringOrNull(record.status ?? record.accountStatus ?? record.account_status),
    phones: rawPhones.map((phone) => normalizePhone(phone, wabaId)),
  };
}

function normalizeDiscovery(value: unknown, connectionId: string): ManualDiscoveryResult {
  const record = valueAsRecord(value);
  const validation = valueAsRecord(record.validation);
  const returnedConnectionId = stringOrNull(record.connectionId ?? record.connection_id)?.trim() ?? "";
  const rawAccounts = Array.isArray(record.accounts)
    ? record.accounts
    : Array.isArray(record.wabas)
      ? record.wabas
      : Array.isArray(record.whatsappBusinessAccounts)
        ? record.whatsappBusinessAccounts
        : null;

  if (
    !returnedConnectionId ||
    returnedConnectionId !== connectionId ||
    validation.valid !== true ||
    validation.tokenType !== "SYSTEM_USER" ||
    !rawAccounts
  ) {
    invalidManualSuccessResponse();
  }

  return {
    connectionId: returnedConnectionId,
    accounts: rawAccounts.map(normalizeAccount),
  };
}

function normalizeRequiredManualConnection(
  value: unknown,
  connectionId: string,
  expectedStatus: "VERIFYING" | "ACTIVE",
): CurrentWhatsAppConnectionResponse {
  const record = valueAsRecord(value);
  const connection = valueAsRecord(record.connection);
  const returnedConnectionId = stringOrNull(connection.connectionId ?? connection.connection_id ?? connection.id)?.trim() ?? "";
  const connectionMethod = stringOrNull(connection.connectionMethod ?? connection.connection_method);

  if (
    !returnedConnectionId ||
    returnedConnectionId !== connectionId ||
    connection.status !== expectedStatus ||
    connectionMethod !== CUSTOMER_OWNED_META_APP
  ) {
    invalidManualSuccessResponse();
  }

  return { connection: normalizeConnection(connection) };
}

function normalizeManualSelection(value: unknown, connectionId: string): CurrentWhatsAppConnectionResponse {
  const record = valueAsRecord(value);
  if (record.nextStep !== "CONFIGURE_WEBHOOK") invalidManualSuccessResponse();
  return normalizeRequiredManualConnection(value, connectionId, "VERIFYING");
}

function normalizeManualWebhookConfiguration(value: unknown, connectionId: string): CurrentWhatsAppConnectionResponse {
  const record = valueAsRecord(value);
  const webhook = valueAsRecord(record.webhook);
  if (
    record.nextStep !== "FINALIZE_CONNECTION" ||
    webhook.configured !== true ||
    webhook.verified !== true ||
    webhook.subscriptionConfirmed !== true
  ) {
    invalidManualSuccessResponse();
  }
  return normalizeRequiredManualConnection(value, connectionId, "VERIFYING");
}

function normalizeManualFinalization(value: unknown, connectionId: string): CurrentWhatsAppConnectionResponse {
  const record = valueAsRecord(value);
  const health = valueAsRecord(record.health);
  if (health.status !== "HEALTHY") invalidManualSuccessResponse();
  return normalizeRequiredManualConnection(value, connectionId, "ACTIVE");
}

export const httpEmbeddedSignupCompletionService: EmbeddedSignupCompletionService = {
  async complete(input) {
    const response = await requestJson<{ verified?: unknown }>("/api/whatsapp-connections/embedded-signup/complete", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { success: response.verified === true };
  },
  loadCurrent() {
    return requestJson<unknown>("/api/whatsapp-connections/current", {
      method: "GET",
      body: undefined,
    }).then(normalizeCurrentResponse);
  },
  disconnect(connectionId) {
    return requestJson<DisconnectWhatsAppConnectionResponse>(`/api/whatsapp-connections/${encodeURIComponent(connectionId)}/disconnect`, {
      method: "POST",
      body: emptyBody(),
    });
  },
  setupManual(input) {
    const validation = validateManualSetupCredentials(input);
    if (!validation.valid) invalidManualInput(validation.message);

    const connectionId = input.connectionId?.trim() ?? "";
    if (
      input.connectionId !== undefined &&
      (!connectionId || connectionId.length > MANUAL_CONNECTION_ID_MAX_LENGTH)
    ) {
      invalidManualInput("This WhatsApp connection cannot be updated safely.");
    }

    const normalizedInput: ManualSetupInput = {
      ...validation.value,
      ...(connectionId ? { connectionId } : {}),
    };
    const path = connectionId
      ? `/api/whatsapp-connections/manual/${encodeURIComponent(connectionId)}/credentials`
      : "/api/whatsapp-connections/manual/setup";
    return requestJson<unknown>(path, {
      method: "POST",
      body: JSON.stringify({
        appId: normalizedInput.appId,
        appSecret: normalizedInput.appSecret,
        systemUserAccessToken: normalizedInput.systemUserAccessToken,
      }),
    }).then((response) => safeManualSetupFromBackend(response, normalizedInput));
  },
  discoverManual(connectionId) {
    return requestJson<unknown>(`/api/whatsapp-connections/manual/${encodeURIComponent(connectionId)}/discover`, {
      method: "POST",
      body: emptyBody(),
    }).then((response) => normalizeDiscovery(response, connectionId));
  },
  selectManualAssets(input) {
    return requestJson<unknown>(`/api/whatsapp-connections/manual/${encodeURIComponent(input.connectionId)}/select-assets`, {
      method: "POST",
      body: JSON.stringify({ wabaId: input.wabaId, phoneNumberId: input.phoneNumberId }),
    }).then((response) => normalizeManualSelection(response, input.connectionId));
  },
  configureManualWebhook(connectionId) {
    return requestJson<unknown>(`/api/whatsapp-connections/manual/${encodeURIComponent(connectionId)}/configure-webhook`, {
      method: "POST",
      body: emptyBody(),
    }).then((response) => normalizeManualWebhookConfiguration(response, connectionId));
  },
  finalizeManual(connectionId) {
    return requestJson<unknown>(`/api/whatsapp-connections/manual/${encodeURIComponent(connectionId)}/finalize`, {
      method: "POST",
      body: emptyBody(),
    }).then((response) => normalizeManualFinalization(response, connectionId));
  },
};
