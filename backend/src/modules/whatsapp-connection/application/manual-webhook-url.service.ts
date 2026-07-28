import { env } from "../../../config/env";
import { ManualWebhookConfigurationError } from "../domain/whatsapp-connection.errors";

const MAX_META_CALLBACK_URL_LENGTH = 1024;

export function buildManualWebhookCallbackUrl(publicWebhookId: string, baseUrl = env.publicBaseUrl): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/u, "");
  if (!trimmedBaseUrl) throw new ManualWebhookConfigurationError("WEBHOOK_PUBLIC_URL_INVALID");
  let parsed: URL;
  try {
    parsed = new URL(trimmedBaseUrl);
  } catch {
    throw new ManualWebhookConfigurationError("WEBHOOK_PUBLIC_URL_INVALID");
  }
  if (parsed.protocol !== "https:") throw new ManualWebhookConfigurationError("WEBHOOK_PUBLIC_URL_INVALID");
  const callbackUrl = `${trimmedBaseUrl}/api/whatsapp/webhooks/connections/${publicWebhookId}`;
  if (callbackUrl.length > MAX_META_CALLBACK_URL_LENGTH) throw new ManualWebhookConfigurationError("WEBHOOK_PUBLIC_URL_INVALID");
  return callbackUrl;
}

