import { authenticatedBackendFetch, BackendHttpConfigurationError } from "@/lib/backend-http-client";
import type { ConversationResetResult, DevelopmentTenantReadiness } from "../types/development-tenant.types";

export const developmentTenantStatusQueryKey = ["development-tenant", "status"] as const;

export class DevelopmentTenantHttpError extends Error {
  constructor(readonly status: number, readonly issueCode?: string) { super("Development Tenant is unavailable."); this.name = "DevelopmentTenantHttpError"; }
}
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; }
function readiness(value: unknown): DevelopmentTenantReadiness {
  const body = record(value); const status = body.status;
  if (!["NOT_CONFIGURED", "CONNECTION_REQUIRED", "COMMERCE_REQUIRED", "READY", "DEGRADED"].includes(String(status))) throw new DevelopmentTenantHttpError(502);
  return { configured: body.configured === true, connectionStatus: typeof body.connectionStatus === "string" ? body.connectionStatus : undefined,
    connectionMethod: typeof body.connectionMethod === "string" ? body.connectionMethod : undefined,
    commerceReadiness: body.commerceReadiness === "READY" ? "READY" : "NOT_READY", productCount: typeof body.productCount === "number" ? body.productCount : 0,
    conversationConfigAvailable: body.conversationConfigAvailable === true, encryptedCredentialSourceAvailable: body.encryptedCredentialSourceAvailable === true,
    receiptBrandingAvailable: body.receiptBrandingAvailable === true, runtimeReady: body.runtimeReady === true, status: status as DevelopmentTenantReadiness["status"],
    blockers: Array.isArray(body.blockers) ? body.blockers.filter((item): item is string => typeof item === "string") : [] };
}
async function request(path: string, method: "GET" | "POST"): Promise<unknown> {
  let response: Response;
  try { response = await authenticatedBackendFetch(path, { method, ...(method === "POST" ? { body: JSON.stringify({}) } : {}) }); }
  catch (error) { if (error instanceof BackendHttpConfigurationError) throw new DevelopmentTenantHttpError(0); throw new DevelopmentTenantHttpError(0); }
  if (!response.ok) { let issueCode: string | undefined; try { const body = record(await response.json()); issueCode = typeof body.issueCode === "string" ? body.issueCode : undefined; } catch { /* safe fallback */ } throw new DevelopmentTenantHttpError(response.status, issueCode); }
  return response.json();
}
export const developmentTenantService = {
  async loadStatus(): Promise<DevelopmentTenantReadiness> { return readiness(await request("/api/development-tenant/status", "GET")); },
  async resetConversation(): Promise<ConversationResetResult> { const body = record(await request("/api/development-tenant/reset-conversation", "POST")); return { deletedKeyCount: typeof body.deletedKeyCount === "number" ? body.deletedKeyCount : 0 }; },
};
