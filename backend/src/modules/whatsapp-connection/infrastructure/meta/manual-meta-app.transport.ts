import { WhatsAppConnectionMetaTransportError } from "../../domain/whatsapp-connection.errors";

export type ManualMetaTokenInspectionResult = Readonly<{
  valid: boolean;
  appId?: string | null;
  type?: string | null;
  scopes: readonly string[];
  expiresAt?: Date | null;
  systemUserId?: string | null;
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
  status?: string | null;
  codeVerificationStatus?: string | null;
}>;

export interface ManualMetaAppTransport {
  inspectSystemUserToken(appId: string, appSecret: string, systemUserAccessToken: string): Promise<ManualMetaTokenInspectionResult>;
  listAssignedWabas(systemUserId: string, systemUserAccessToken: string): Promise<readonly ManualMetaWaba[]>;
  listPhoneNumbers(wabaId: string, systemUserAccessToken: string): Promise<readonly ManualMetaPhoneNumber[]>;
}

type JsonRecord = Record<string, unknown>;
type GraphErrorCode = "configuration" | "auth" | "not_found" | "validation" | "unavailable";

const GRAPH_BASE_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_PAGES = 5;
const MAX_ASSETS = 100;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classifyStatus(status: number): GraphErrorCode {
  if (status === 400) return "validation";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  return "unavailable";
}

function expiresAt(value: unknown): Date | null {
  const seconds = numberField(value);
  if (!seconds || seconds <= 0) return null;
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

  private async request(path: string, params: URLSearchParams, accessToken?: string): Promise<JsonRecord> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      if (accessToken) params.set("access_token", accessToken);
      const response = await this.fetchImpl(this.graphUrl(path, params), { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
      const body = await boundedJson(response);
      if (!response.ok) throw new WhatsAppConnectionMetaTransportError(classifyStatus(response.status));
      return body;
    } catch (error) {
      if (error instanceof WhatsAppConnectionMetaTransportError) throw error;
      throw new WhatsAppConnectionMetaTransportError("unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async listPaged(path: string, params: URLSearchParams, accessToken: string): Promise<readonly JsonRecord[]> {
    const rows: JsonRecord[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES && rows.length < MAX_ASSETS; page += 1) {
      const pageParams = new URLSearchParams(params);
      pageParams.set("limit", "25");
      if (after) pageParams.set("after", after);
      const body = await this.request(path, pageParams, accessToken);
      const data = Array.isArray(body.data) ? body.data.filter(isRecord) : [];
      rows.push(...data.slice(0, MAX_ASSETS - rows.length));
      after = pageAfter(body, seen);
      if (!after) break;
    }
    return rows;
  }

  async inspectSystemUserToken(appId: string, appSecret: string, systemUserAccessToken: string): Promise<ManualMetaTokenInspectionResult> {
    const body = await this.request("debug_token", new URLSearchParams({
      input_token: systemUserAccessToken,
      access_token: `${appId}|${appSecret}`,
    }));
    const data = isRecord(body.data) ? body.data : {};
    const scopes = Array.isArray(data.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    return {
      valid: data.is_valid === true,
      appId: stringField(data.app_id),
      type: stringField(data.type),
      scopes,
      expiresAt: expiresAt(data.expires_at),
      systemUserId: stringField(data.user_id) ?? stringField(data.profile_id),
    };
  }

  async listAssignedWabas(systemUserId: string, systemUserAccessToken: string): Promise<readonly ManualMetaWaba[]> {
    const rows = await this.listPaged(`${systemUserId}/assigned_whatsapp_business_accounts`, new URLSearchParams({ fields: "id,name,account_status" }), systemUserAccessToken);
    return rows.map((row) => ({ id: stringField(row.id) ?? "", name: stringField(row.name), accountStatus: stringField(row.account_status) })).filter((row) => row.id);
  }

  async listPhoneNumbers(wabaId: string, systemUserAccessToken: string): Promise<readonly ManualMetaPhoneNumber[]> {
    const rows = await this.listPaged(`${wabaId}/phone_numbers`, new URLSearchParams({ fields: "id,display_phone_number,verified_name,status,code_verification_status" }), systemUserAccessToken);
    return rows.map((row) => ({
      id: stringField(row.id) ?? "",
      wabaId,
      displayPhoneNumber: stringField(row.display_phone_number),
      verifiedName: stringField(row.verified_name),
      status: stringField(row.status),
      codeVerificationStatus: stringField(row.code_verification_status),
    })).filter((row) => row.id);
  }
}

export const __phase11kM2ManualMetaTransportTesting = {
  validatePagingOrigin,
};
