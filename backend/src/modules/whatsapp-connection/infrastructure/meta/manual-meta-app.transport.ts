import {
  WhatsAppConnectionMetaTransportError,
  type WhatsAppConnectionMetaOperation,
  type WhatsAppConnectionMetaTransportCode,
} from "../../domain/whatsapp-connection.errors";

export type ManualMetaTokenInspectionResult = Readonly<{
  valid: boolean;
  appId?: string | null;
  type?: string | null;
  scopes: readonly string[];
  expiresAt?: Date | null;
  systemUserId?: string | null;
  assignedWabaIds?: readonly string[];
}>;

export type ManualMetaWaba = Readonly<{
  id: string;
  name?: string | null;
  accountStatus?: string | null;
}>;

export type ManualMetaPhoneNumber = Readonly<{
  id: string;
  wabaId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  qualityRating?: string | null;
  status?: string | null;
  codeVerificationStatus?: string | null;
}>;

export type ManualMetaWabaSubscription = Readonly<{
  appId: string;
  callbackUrl?: string | null;
}>;

export type ManualMetaPhoneRegistrationStatus = Readonly<{
  id: string;
  registered: boolean;
}>;

export interface ManualMetaAppTransport {
  inspectSystemUserToken(appId: string, appSecret: string, systemUserAccessToken: string): Promise<ManualMetaTokenInspectionResult>;
  listAssignedWabas(systemUserId: string, systemUserAccessToken: string): Promise<readonly ManualMetaWaba[]>;
  readWaba?(wabaId: string, systemUserAccessToken: string): Promise<ManualMetaWaba>;
  listPhoneNumbers(wabaId: string, systemUserAccessToken: string): Promise<readonly ManualMetaPhoneNumber[]>;
  readPhoneNumber?(phoneNumberId: string, systemUserAccessToken: string): Promise<ManualMetaPhoneNumber>;
}

export interface ManualMetaWebhookTransport extends ManualMetaAppTransport {
  subscribeWabaWithCallback(wabaId: string, callbackUrl: string, verifyToken: string, systemUserAccessToken: string): Promise<void>;
  listWabaSubscriptions(wabaId: string, systemUserAccessToken: string): Promise<readonly ManualMetaWabaSubscription[]>;
  setPhoneTwoStepVerificationPin?(phoneNumberId: string, registrationPin: string, systemUserAccessToken: string): Promise<void>;
  registerPhoneNumber(phoneNumberId: string, registrationPin: string, systemUserAccessToken: string): Promise<void>;
  readPhoneRegistrationStatus(phoneNumberId: string, systemUserAccessToken: string): Promise<ManualMetaPhoneRegistrationStatus>;
}

type JsonRecord = Record<string, unknown>;

const GRAPH_BASE_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_PAGES = 5;
const MAX_ASSETS = 100;
const MAX_META_ERROR_CODE = 2_147_483_647;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaAssetIdField(value: unknown): string | null {
  const id = stringField(value);
  return id && id.length <= 32 && /^[0-9]+$/u.test(id) ? id : null;
}

function metaScopeField(value: unknown): string | null {
  const scope = stringField(value);
  return scope && scope.length <= 128 && /^[a-z0-9_]+$/u.test(scope) ? scope : null;
}

function metaAccessTokenField(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 4096) return null;
  if (value.trim() !== value || /[\s"'`“”‘’]/u.test(value)) return null;
  return value;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeHttpStatus(value: number): number | null {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function metaErrorCode(body: JsonRecord): number | null {
  const error = isRecord(body.error) ? body.error : {};
  const code = numberField(error.code);
  return code !== null && Number.isSafeInteger(code) && code >= 0 && code <= MAX_META_ERROR_CODE
    ? code
    : null;
}

function metaErrorSubcode(body: JsonRecord): number | null {
  const error = isRecord(body.error) ? body.error : {};
  const subcode = numberField(error.error_subcode);
  return subcode !== null && Number.isSafeInteger(subcode) && subcode >= 0 && subcode <= MAX_META_ERROR_CODE
    ? subcode
    : null;
}

function classifyStatus(status: number, numericMetaErrorCode: number | null): WhatsAppConnectionMetaTransportCode {
  if (numericMetaErrorCode === 190) return "auth";
  if (status === 400) return "validation";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  return "unavailable";
}

function withOperation(
  error: WhatsAppConnectionMetaTransportError,
  operation: WhatsAppConnectionMetaOperation,
  httpStatus: number | null = null,
): WhatsAppConnectionMetaTransportError {
  if (error.operation) return error;
  return new WhatsAppConnectionMetaTransportError(error.code, {
    operation,
    httpStatus: error.httpStatus ?? httpStatus,
    metaErrorCode: error.metaErrorCode,
    metaErrorSubcode: error.metaErrorSubcode,
  });
}

function expiresAt(value: unknown): Date | null {
  const seconds = numberField(value);
  if (seconds === null || seconds === 0) return null;
  if (seconds < 0) return new Date(Number.NaN);
  return new Date(seconds * 1000);
}

async function boundedJson(response: Response): Promise<JsonRecord> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) throw new WhatsAppConnectionMetaTransportError("unavailable");
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    throw new WhatsAppConnectionMetaTransportError("unavailable");
  }
}

function validatePagingOrigin(next: unknown): void {
  if (next === undefined || next === null) return;
  const value = stringField(next);
  if (!value) throw new WhatsAppConnectionMetaTransportError("unavailable");
  try {
    const parsed = new URL(value);
    if (parsed.origin !== GRAPH_BASE_URL) throw new WhatsAppConnectionMetaTransportError("unavailable");
  } catch (error) {
    if (error instanceof WhatsAppConnectionMetaTransportError) throw error;
    throw new WhatsAppConnectionMetaTransportError("unavailable");
  }
}

function pageAfter(body: JsonRecord, seen: Set<string>): string | null {
  const paging = isRecord(body.paging) ? body.paging : {};
  validatePagingOrigin(paging.next);
  const cursors = isRecord(paging.cursors) ? paging.cursors : {};
  const after = stringField(cursors.after);
  if (!after) return null;
  if (seen.has(after)) throw new WhatsAppConnectionMetaTransportError("unavailable");
  seen.add(after);
  return after;
}

export class FetchManualMetaAppTransport implements ManualMetaAppTransport {
  constructor(
    private readonly graphApiVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  private graphUrl(path: string, params: URLSearchParams): string {
    return `${GRAPH_BASE_URL}/${this.graphApiVersion}/${path}?${params.toString()}`;
  }

  private oauthUrl(params: URLSearchParams): string {
    return `${GRAPH_BASE_URL}/oauth/access_token?${params.toString()}`;
  }

  private async request(
    operation: WhatsAppConnectionMetaOperation,
    path: string,
    params: URLSearchParams,
    accessToken?: string,
    unversioned = false,
  ): Promise<JsonRecord> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let httpStatus: number | null = null;
    try {
      const response = await this.fetchImpl(unversioned ? this.oauthUrl(params) : this.graphUrl(path, params), {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        signal: controller.signal,
      });
      httpStatus = safeHttpStatus(response.status);
      const body = await boundedJson(response);
      const numericMetaErrorCode = metaErrorCode(body);
      const numericMetaErrorSubcode = metaErrorSubcode(body);
      if (!response.ok) {
        throw new WhatsAppConnectionMetaTransportError(classifyStatus(response.status, numericMetaErrorCode), {
          operation,
          httpStatus,
          metaErrorCode: numericMetaErrorCode,
          metaErrorSubcode: numericMetaErrorSubcode,
        });
      }
      return body;
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) throw withOperation(error, operation, httpStatus);
      throw new WhatsAppConnectionMetaTransportError("unavailable", { operation, httpStatus });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post(
    operation: WhatsAppConnectionMetaOperation,
    path: string,
    params: URLSearchParams,
    accessToken: string,
  ): Promise<JsonRecord> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let httpStatus: number | null = null;
    try {
      const response = await this.fetchImpl(this.graphUrl(path, new URLSearchParams()), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: controller.signal,
      });
      httpStatus = safeHttpStatus(response.status);
      const body = await boundedJson(response);
      const numericMetaErrorCode = metaErrorCode(body);
      const numericMetaErrorSubcode = metaErrorSubcode(body);
      if (!response.ok) {
        throw new WhatsAppConnectionMetaTransportError(classifyStatus(response.status, numericMetaErrorCode), {
          operation,
          httpStatus,
          metaErrorCode: numericMetaErrorCode,
          metaErrorSubcode: numericMetaErrorSubcode,
        });
      }
      return body;
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) throw withOperation(error, operation, httpStatus);
      throw new WhatsAppConnectionMetaTransportError("unavailable", { operation, httpStatus });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postJson(
    operation: WhatsAppConnectionMetaOperation,
    path: string,
    payload: JsonRecord,
    accessToken: string,
  ): Promise<JsonRecord> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let httpStatus: number | null = null;
    try {
      const response = await this.fetchImpl(this.graphUrl(path, new URLSearchParams()), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      httpStatus = safeHttpStatus(response.status);
      const body = await boundedJson(response);
      const numericMetaErrorCode = metaErrorCode(body);
      const numericMetaErrorSubcode = metaErrorSubcode(body);
      if (!response.ok) {
        throw new WhatsAppConnectionMetaTransportError(classifyStatus(response.status, numericMetaErrorCode), {
          operation,
          httpStatus,
          metaErrorCode: numericMetaErrorCode,
          metaErrorSubcode: numericMetaErrorSubcode,
        });
      }
      return body;
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) throw withOperation(error, operation, httpStatus);
      throw new WhatsAppConnectionMetaTransportError("unavailable", { operation, httpStatus });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async listPaged(
    operation: WhatsAppConnectionMetaOperation,
    path: string,
    params: URLSearchParams,
    accessToken: string,
  ): Promise<readonly JsonRecord[]> {
    const rows: JsonRecord[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES && rows.length < MAX_ASSETS; page += 1) {
      const pageParams = new URLSearchParams(params);
      pageParams.set("limit", "25");
      if (after) pageParams.set("after", after);
      const body = await this.request(operation, path, pageParams, accessToken);
      const data = Array.isArray(body.data) ? body.data.filter(isRecord) : [];
      rows.push(...data.slice(0, MAX_ASSETS - rows.length));
      try {
        after = pageAfter(body, seen);
      } catch (error) {
        if (error instanceof WhatsAppConnectionMetaTransportError) throw withOperation(error, operation);
        throw new WhatsAppConnectionMetaTransportError("unavailable", { operation });
      }
      if (!after) break;
    }
    return rows;
  }

  private async acquireAppAccessToken(appId: string, appSecret: string): Promise<string> {
    const body = await this.request(
      "acquire_app_access_token",
      "oauth/access_token",
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "client_credentials",
      }),
      undefined,
      true,
    );
    const appAccessToken = metaAccessTokenField(body.access_token);
    if (!appAccessToken) {
      throw new WhatsAppConnectionMetaTransportError("configuration", {
        operation: "acquire_app_access_token",
        httpStatus: 200,
      });
    }
    return appAccessToken;
  }

  async inspectSystemUserToken(appId: string, appSecret: string, systemUserAccessToken: string): Promise<ManualMetaTokenInspectionResult> {
    const appAccessToken = await this.acquireAppAccessToken(appId, appSecret);
    const body = await this.request("inspect_system_user_token", "debug_token", new URLSearchParams({
      input_token: systemUserAccessToken,
    }), appAccessToken);
    const data = isRecord(body.data) ? body.data : {};
    const scopes: string[] = [];
    const seenScopes = new Set<string>();
    const addScope = (value: unknown): string | null => {
      const scope = metaScopeField(value);
      if (!scope) return null;
      if (!seenScopes.has(scope) && scopes.length < MAX_ASSETS) {
        seenScopes.add(scope);
        scopes.push(scope);
      }
      return scope;
    };
    if (Array.isArray(data.scopes)) {
      for (const scope of data.scopes.slice(0, MAX_ASSETS)) addScope(scope);
    }
    const assignedWabaIds: string[] = [];
    const seenAssignedWabaIds = new Set<string>();
    const granularScopes = Array.isArray(data.granular_scopes)
      ? data.granular_scopes.filter(isRecord).slice(0, MAX_ASSETS)
      : [];
    for (const granularScope of granularScopes) {
      const scope = addScope(granularScope.scope);
      if (scope !== "whatsapp_business_management" || !Array.isArray(granularScope.target_ids)) continue;
      for (const targetId of granularScope.target_ids.slice(0, MAX_ASSETS)) {
        const id = metaAssetIdField(targetId);
        if (!id || seenAssignedWabaIds.has(id) || assignedWabaIds.length >= MAX_ASSETS) continue;
        seenAssignedWabaIds.add(id);
        assignedWabaIds.push(id);
      }
    }
    const tokenExpiresAt = expiresAt(data.expires_at);
    if (tokenExpiresAt && !Number.isFinite(tokenExpiresAt.getTime())) {
      throw new WhatsAppConnectionMetaTransportError("validation", {
        operation: "inspect_system_user_token",
        httpStatus: 200,
      });
    }
    return {
      valid: data.is_valid === true,
      appId: stringField(data.app_id),
      type: stringField(data.type),
      scopes,
      expiresAt: tokenExpiresAt,
      systemUserId: stringField(data.user_id) ?? stringField(data.profile_id),
      assignedWabaIds,
    };
  }

  async listAssignedWabas(_systemUserId: string, systemUserAccessToken: string): Promise<readonly ManualMetaWaba[]> {
    const rows = await this.listPaged(
      "list_assigned_wabas",
      "me/assigned_whatsapp_business_accounts",
      new URLSearchParams({ fields: "id,name" }),
      systemUserAccessToken,
    );
    return rows
      .map((row) => ({ id: metaAssetIdField(row.id) ?? "", name: stringField(row.name), accountStatus: null }))
      .filter((row) => row.id);
  }

  async readWaba(wabaId: string, systemUserAccessToken: string): Promise<ManualMetaWaba> {
    const body = await this.request(
      "read_waba",
      wabaId,
      new URLSearchParams({ fields: "id,name" }),
      systemUserAccessToken,
    );
    const id = metaAssetIdField(body.id);
    if (!id || id !== wabaId) {
      throw new WhatsAppConnectionMetaTransportError("not_found", { operation: "read_waba" });
    }
    return {
      id,
      name: stringField(body.name),
      accountStatus: null,
    };
  }

  async listPhoneNumbers(wabaId: string, systemUserAccessToken: string): Promise<readonly ManualMetaPhoneNumber[]> {
    const rows = await this.listPaged(
      "list_waba_phone_numbers",
      `${wabaId}/phone_numbers`,
      new URLSearchParams({ fields: "id,display_phone_number,verified_name,quality_rating,status" }),
      systemUserAccessToken,
    );
    return rows.map((row) => ({
      id: metaAssetIdField(row.id) ?? "",
      wabaId,
      displayPhoneNumber: stringField(row.display_phone_number),
      verifiedName: stringField(row.verified_name),
      qualityRating: stringField(row.quality_rating),
      status: stringField(row.status),
      codeVerificationStatus: null,
    })).filter((row) => row.id);
  }

  async readPhoneNumber(phoneNumberId: string, systemUserAccessToken: string): Promise<ManualMetaPhoneNumber> {
    const body = await this.request(
      "read_phone_number",
      phoneNumberId,
      new URLSearchParams({ fields: "id,display_phone_number,verified_name,quality_rating,status" }),
      systemUserAccessToken,
    );
    const id = metaAssetIdField(body.id);
    if (!id || id !== phoneNumberId) {
      throw new WhatsAppConnectionMetaTransportError("not_found", { operation: "read_phone_number" });
    }
    return {
      id,
      wabaId: "",
      displayPhoneNumber: stringField(body.display_phone_number),
      verifiedName: stringField(body.verified_name),
      qualityRating: stringField(body.quality_rating),
      status: stringField(body.status),
      codeVerificationStatus: null,
    };
  }

  async subscribeWabaWithCallback(wabaId: string, callbackUrl: string, verifyToken: string, systemUserAccessToken: string): Promise<void> {
    const body = await this.postJson("subscribe_waba", `${wabaId}/subscribed_apps`, {
      override_callback_uri: callbackUrl,
      verify_token: verifyToken,
    }, systemUserAccessToken);
    const returnedSubscriptions = Array.isArray(body.data)
      ? body.data.filter(isRecord)
      : [];
    if (body.success !== true && returnedSubscriptions.length === 0) {
      throw new WhatsAppConnectionMetaTransportError("validation", { operation: "subscribe_waba" });
    }
  }

  async listWabaSubscriptions(wabaId: string, systemUserAccessToken: string): Promise<readonly ManualMetaWabaSubscription[]> {
    const rows = await this.listPaged(
      "list_waba_subscriptions",
      `${wabaId}/subscribed_apps`,
      new URLSearchParams(),
      systemUserAccessToken,
    );
    return rows.map((row) => {
      const whatsappBusinessApiData = isRecord(row.whatsapp_business_api_data)
        ? row.whatsapp_business_api_data
        : {};
      return {
        appId: metaAssetIdField(whatsappBusinessApiData.id) ?? metaAssetIdField(row.id) ?? "",
        callbackUrl: stringField(row.override_callback_uri) ?? stringField(row.callback_url),
      };
    }).filter((row) => row.appId);
  }

  async registerPhoneNumber(phoneNumberId: string, registrationPin: string, systemUserAccessToken: string): Promise<void> {
    const body = await this.postJson("register_phone_number", `${phoneNumberId}/register`, {
      messaging_product: "whatsapp",
      pin: registrationPin,
    }, systemUserAccessToken);
    if (body.success !== true) {
      throw new WhatsAppConnectionMetaTransportError("validation", { operation: "register_phone_number" });
    }
  }

  async setPhoneTwoStepVerificationPin(phoneNumberId: string, registrationPin: string, systemUserAccessToken: string): Promise<void> {
    const body = await this.postJson("set_phone_two_step_verification_pin", phoneNumberId, {
      pin: registrationPin,
    }, systemUserAccessToken);
    if (body.success !== true) {
      throw new WhatsAppConnectionMetaTransportError("validation", {
        operation: "set_phone_two_step_verification_pin",
      });
    }
  }

  async readPhoneRegistrationStatus(phoneNumberId: string, systemUserAccessToken: string): Promise<ManualMetaPhoneRegistrationStatus> {
    const body = await this.request(
      "read_phone_registration_status",
      phoneNumberId,
      new URLSearchParams({ fields: "id,status" }),
      systemUserAccessToken,
    );
    const id = stringField(body.id);
    const status = stringField(body.status);
    if (!id || !status) {
      throw new WhatsAppConnectionMetaTransportError("not_found", { operation: "read_phone_registration_status" });
    }
    return { id, registered: status.toUpperCase() === "CONNECTED" };
  }
}

export const __phase11kM2ManualMetaTransportTesting = {
  validatePagingOrigin,
};
