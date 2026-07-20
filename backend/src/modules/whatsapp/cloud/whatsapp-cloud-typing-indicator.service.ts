import { env } from "../../../config/env";

export type TypingSkipReason = "disabled" | "missing_message_id" | "not_cloud_provider" | "status_webhook" | "no_reply" | "duplicate" | "guard_blocked" | "dry_run";
export type TypingResult = { attempted: boolean; displayed: boolean; dryRun: boolean; skippedReason?: TypingSkipReason; failureCategory?: "timeout" | "graph_error" | "network_error" | "invalid_input"; durationMs: number };
type TransportResult = { success: boolean; dryRun: boolean; errorMessage?: string };
type Transport = (phoneNumberId: string, payload: unknown) => Promise<TransportResult>;

function log(payload: Record<string, unknown>) { console.log(JSON.stringify(payload)); }
function shortId(value: string) { return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value; }
function clamp(value: number, min: number, max: number) { return Math.min(Math.max(value, min), max); }

export async function activateTypingIndicator(input: { messageId?: string; phoneNumberId: string; messageType?: string; sellerId?: string; dryRun?: boolean; guardBlocked?: boolean; transport: Transport }): Promise<TypingResult> {
  const startedAt = Date.now();
  if (input.guardBlocked) { log({ event: "whatsapp.cloud.typing.skipped", reason: "guard_blocked" }); return { attempted: false, displayed: false, dryRun: false, skippedReason: "guard_blocked", durationMs: 0 }; }
  if (!env.whatsappTypingIndicatorEnabled) { log({ event: "whatsapp.cloud.typing.skipped", reason: "disabled" }); return { attempted: false, displayed: false, dryRun: false, skippedReason: "disabled", durationMs: 0 }; }
  if (!input.messageId?.trim()) { log({ event: "whatsapp.cloud.typing.skipped", reason: "missing_message_id" }); return { attempted: false, displayed: false, dryRun: false, skippedReason: "missing_message_id", durationMs: 0 }; }
  if (!input.phoneNumberId.trim()) { log({ event: "whatsapp.cloud.typing.skipped", reason: "not_cloud_provider" }); return { attempted: false, displayed: false, dryRun: false, skippedReason: "not_cloud_provider", durationMs: 0 }; }
  if (input.dryRun || env.whatsappCloudDryRun) {
    log({ event: "whatsapp.cloud.typing.skipped", reason: "dry_run", dryRun: true });
    return { attempted: false, displayed: false, dryRun: true, skippedReason: "dry_run", durationMs: 0 };
  }
  const payload = { messaging_product: "whatsapp", status: "read", message_id: input.messageId, typing_indicator: { type: "text" } };
  log({ event: "whatsapp.cloud.typing.requested", sellerId: input.sellerId, messageId: shortId(input.messageId), messageType: input.messageType, dryRun: Boolean(input.dryRun || env.whatsappCloudDryRun) });
  try {
    const result = await Promise.race([input.transport(input.phoneNumberId, payload), new Promise<TransportResult>((_, reject) => setTimeout(() => reject(new Error("Typing indicator request timed out")), env.whatsappTypingRequestTimeoutMs))]);
    const durationMs = Date.now() - startedAt;
    if (result.success) { log({ event: "whatsapp.cloud.typing.displayed", messageId: shortId(input.messageId), dryRun: result.dryRun, durationMs }); return { attempted: true, displayed: true, dryRun: result.dryRun, durationMs }; }
    log({ event: "whatsapp.cloud.typing.failed", messageId: shortId(input.messageId), failureCategory: "graph_error", errorMessage: result.errorMessage, durationMs });
    return { attempted: true, displayed: false, dryRun: result.dryRun, failureCategory: "graph_error", durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const timeout = error instanceof Error && error.message.includes("timed out");
    log({ event: "whatsapp.cloud.typing.failed", messageId: shortId(input.messageId), failureCategory: timeout ? "timeout" : "network_error", durationMs });
    return { attempted: true, displayed: false, dryRun: false, failureCategory: timeout ? "timeout" : "network_error", durationMs };
  }
}

export async function applyReplyPacing(input: { replyText: string; processingDurationMs: number }): Promise<number> {
  if (!env.whatsappTypingIndicatorEnabled) return 0;
  const target = clamp(env.whatsappTypingMinDelayMs + Math.min(900, Math.ceil(input.replyText.length * 3)), env.whatsappTypingMinDelayMs, env.whatsappTypingMaxDelayMs);
  const remaining = Math.max(0, target - input.processingDurationMs);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  log({ event: "whatsapp.cloud.reply.pacing_applied", targetDelayMs: target, processingDurationMs: input.processingDurationMs, pacingDelayMs: remaining });
  return remaining;
}
