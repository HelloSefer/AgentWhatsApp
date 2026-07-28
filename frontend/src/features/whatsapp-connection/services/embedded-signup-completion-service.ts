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
  | "META_TOKEN_INVALID"
  | "META_TOKEN_EXPIRED"
  | "META_TOKEN_APP_MISMATCH"
  | "META_PERMISSION_MISSING"
  | "META_WABA_ACCESS_MISSING"
  | "META_PHONE_ACCESS_MISSING"
  | "WEBHOOK_SUBSCRIPTION_FAILED"
  | "WEBHOOK_PUBLIC_URL_INVALID"
  | "CONNECTION_ACTIVATION_CONFLICT"
  | "META_TRANSIENT_FAILURE";

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
}>;

export type ManualSetupInput = Readonly<{
  appId: string;
  appSecret: string;
  systemUserAccessToken: string;
}>;

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

const DEFAULT_BACKEND_BASE_URL = "http://localhost:5000";
const CUSTOMER_OWNED_META_APP = "CUSTOMER_OWNED_META_APP";

const ISSUE_MESSAGES: Record<ManualConnectionIssueCode, string> = {
  META_TOKEN_INVALID: "Meta could not verify this access token.",
  META_TOKEN_EXPIRED: "This Meta access token has expired. Generate a new System User token.",
  META_TOKEN_APP_MISMATCH: "This access token belongs to a different Meta App.",
  META_PERMISSION_MISSING: "The System User is missing a required WhatsApp permission.",
  META_WABA_ACCESS_MISSING: "No accessible WhatsApp Business Account was found.",
  META_PHONE_ACCESS_MISSING: "The selected phone number is no longer accessible.",
  WEBHOOK_SUBSCRIPTION_FAILED: "Meta could not complete the secure webhook connection.",
  WEBHOOK_PUBLIC_URL_INVALID: "The AgentWhatsApp connection address is not ready.",
  CONNECTION_ACTIVATION_CONFLICT: "This WhatsApp number is already connected elsewhere.",
  META_TRANSIENT_FAILURE: "Meta is temporarily unavailable. Try again shortly.",
};

function backendBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_BACKEND_BASE_URL
  ).replace(/\/+$/u, "");
}

export class EmbeddedSignupCompletionServiceError extends Error implements SafeWhatsappConnectionError {
  readonly code: WhatsappConnectionErrorCode;
  readonly status: number;

  constructor(error: SafeWhatsappConnectionError) {
    super(error.message);
    this.name = "EmbeddedSignupCompletionServiceError";
    this.code = error.code;
    this.status = error.status;
  }
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

async function safeErrorForResponse(response: Response): Promise<SafeWhatsappConnectionError> {
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
    response = await fetch(`${backendBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
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

function safeManualSetupFromBackend(value: unknown): SafeManualSetup {
  const record = valueAsRecord(value);
  const connection = valueAsRecord(record.connection);

  return {
    connectionId: stringOrNull(record.connectionId ?? record.connection_id ?? connection.connectionId ?? connection.connection_id ?? connection.id) ?? "",
    status: statusOrFallback(record.status ?? connection.status),
    connectionMethod: stringOrNull(record.connectionMethod ?? record.connection_method ?? connection.connectionMethod ?? connection.connection_method) ?? CUSTOMER_OWNED_META_APP,
    appId: stringOrNull(record.appId ?? record.app_id ?? connection.appId ?? connection.app_id) ?? "",
  };
}

function normalizePhone(value: unknown, wabaId: string): DiscoveredWhatsAppPhone {
  const record = valueAsRecord(value);
  return {
    wabaId,
    phoneNumberId: stringOrNull(record.phoneNumberId ?? record.phone_number_id ?? record.id) ?? "",
    maskedPhoneNumber: stringOrNull(record.maskedPhoneNumber ?? record.masked_phone_number ?? record.displayPhoneNumber ?? record.display_phone_number),
    verifiedName: stringOrNull(record.verifiedName ?? record.verified_name),
    status: stringOrNull(record.status),
    verificationStatus: stringOrNull(record.verificationStatus ?? record.verification_status),
  };
}

function normalizeAccount(value: unknown): DiscoveredWhatsAppAccount {
  const record = valueAsRecord(value);
  const wabaId = stringOrNull(record.wabaId ?? record.waba_id ?? record.id) ?? "";
  const rawPhones = Array.isArray(record.phones) ? record.phones : Array.isArray(record.phoneNumbers) ? record.phoneNumbers : [];

  return {
    wabaId,
    name: stringOrNull(record.name ?? record.safeName ?? record.safe_name),
    status: stringOrNull(record.status),
    phones: rawPhones.map((phone) => normalizePhone(phone, wabaId)).filter((phone) => phone.wabaId && phone.phoneNumberId),
  };
}

function normalizeDiscovery(value: unknown, connectionId: string): ManualDiscoveryResult {
  const record = valueAsRecord(value);
  const rawAccounts = Array.isArray(record.accounts)
    ? record.accounts
    : Array.isArray(record.wabas)
      ? record.wabas
      : Array.isArray(record.whatsappBusinessAccounts)
        ? record.whatsappBusinessAccounts
        : [];

  return {
    connectionId: stringOrNull(record.connectionId ?? record.connection_id) ?? connectionId,
    accounts: rawAccounts.map(normalizeAccount).filter((account) => account.wabaId),
  };
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
    return requestJson<unknown>("/api/whatsapp-connections/manual/setup", {
      method: "POST",
      body: JSON.stringify(input),
    }).then(safeManualSetupFromBackend);
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
    }).then(normalizeCurrentResponse);
  },
  configureManualWebhook(connectionId) {
    return requestJson<unknown>(`/api/whatsapp-connections/manual/${encodeURIComponent(connectionId)}/configure-webhook`, {
      method: "POST",
      body: emptyBody(),
    }).then(normalizeCurrentResponse);
  },
  finalizeManual(connectionId) {
    return requestJson<unknown>(`/api/whatsapp-connections/manual/${encodeURIComponent(connectionId)}/finalize`, {
      method: "POST",
      body: emptyBody(),
    }).then(normalizeCurrentResponse);
  },
};
