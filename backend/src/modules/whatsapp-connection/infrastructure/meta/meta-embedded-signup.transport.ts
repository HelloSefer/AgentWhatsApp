import type { MetaEmbeddedSignupConfiguration } from "../../application/meta-embedded-signup.config";
import { WhatsAppConnectionMetaTransportError } from "../../domain/whatsapp-connection.errors";

export type MetaCodeExchangeResult = Readonly<{
  accessToken: string;
  tokenExpiresAt?: Date | null;
}>;

export type MetaTokenInspectionResult = Readonly<{
  valid: boolean;
  appId?: string | null;
  scopes: readonly string[];
}>;

export type MetaWabaResult = Readonly<{
  id: string;
  name?: string | null;
}>;

export type MetaPhoneNumberResult = Readonly<{
  id: string;
  wabaId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}>;

export interface MetaEmbeddedSignupTransport {
  exchangeCode(code: string): Promise<MetaCodeExchangeResult>;
  inspectToken(accessToken: string): Promise<MetaTokenInspectionResult>;
  readWaba(wabaId: string, accessToken: string): Promise<MetaWabaResult>;
  readPhoneNumber(phoneNumberId: string, accessToken: string): Promise<MetaPhoneNumberResult>;
}

type GraphErrorCode = "configuration" | "auth" | "not_found" | "validation" | "unavailable";

type JsonRecord = Record<string, unknown>;

const GRAPH_BASE_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;

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

function tokenExpiresAt(expiresIn: unknown): Date | null {
  const seconds = numberField(expiresIn);
  if (!seconds || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000);
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

export class FetchMetaEmbeddedSignupTransport implements MetaEmbeddedSignupTransport {
  constructor(
    private readonly configuration: MetaEmbeddedSignupConfiguration,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  private graphUrl(path: string, params: URLSearchParams): string {
    return `${GRAPH_BASE_URL}/${this.configuration.graphApiVersion}/${path}?${params.toString()}`;
  }

  private async request(path: string, params: URLSearchParams, accessToken?: string): Promise<JsonRecord> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      if (accessToken) params.set("access_token", accessToken);
      const response = await this.fetchImpl(this.graphUrl(path, params), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
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

  async exchangeCode(code: string): Promise<MetaCodeExchangeResult> {
    const body = await this.request("oauth/access_token", new URLSearchParams({
      client_id: this.configuration.appId,
      client_secret: this.configuration.appSecret,
      code,
    }));
    const accessToken = stringField(body.access_token);
    if (!accessToken) throw new WhatsAppConnectionMetaTransportError("auth");
    return {
      accessToken,
      tokenExpiresAt: tokenExpiresAt(body.expires_in),
    };
  }

  async inspectToken(accessToken: string): Promise<MetaTokenInspectionResult> {
    const body = await this.request("debug_token", new URLSearchParams({
      input_token: accessToken,
      access_token: `${this.configuration.appId}|${this.configuration.appSecret}`,
    }));
    const data = isRecord(body.data) ? body.data : {};
    const scopes = Array.isArray(data.scopes)
      ? data.scopes.filter((scope): scope is string => typeof scope === "string")
      : [];
    return {
      valid: data.is_valid === true,
      appId: stringField(data.app_id),
      scopes,
    };
  }

  async readWaba(wabaId: string, accessToken: string): Promise<MetaWabaResult> {
    const body = await this.request(wabaId, new URLSearchParams({ fields: "id,name" }), accessToken);
    const id = stringField(body.id);
    if (!id) throw new WhatsAppConnectionMetaTransportError("not_found");
    return { id, name: stringField(body.name) };
  }

  async readPhoneNumber(phoneNumberId: string, accessToken: string): Promise<MetaPhoneNumberResult> {
    const body = await this.request(phoneNumberId, new URLSearchParams({ fields: "id,display_phone_number,verified_name,whatsapp_business_account" }), accessToken);
    const id = stringField(body.id);
    const waba = isRecord(body.whatsapp_business_account) ? body.whatsapp_business_account : {};
    const wabaId = stringField(waba.id);
    if (!id || !wabaId) throw new WhatsAppConnectionMetaTransportError("not_found");
    return {
      id,
      wabaId,
      displayPhoneNumber: stringField(body.display_phone_number),
      verifiedName: stringField(body.verified_name),
    };
  }
}
