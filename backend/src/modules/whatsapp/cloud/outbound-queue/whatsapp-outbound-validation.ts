import type { WhatsAppOutboundCommand } from "./whatsapp-outbound-command.types";
import type { WhatsAppOutboundResponseGroup } from "./whatsapp-outbound-job.types";
import { WHATSAPP_OUTBOUND_MAX_COMMANDS, WHATSAPP_OUTBOUND_SCHEMA_VERSION } from "./whatsapp-outbound-job.types";
import { WhatsAppOutboundError } from "./whatsapp-outbound.errors";

const FORBIDDEN_KEY_PATTERN = /token|secret|credential|password|authorization|bearer|valkey|postgres|databaseurl|phoneNumberId|phone_number_id|wabaId|waba_id/i;

function assertSafeObjectKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeObjectKeys(item);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new WhatsAppOutboundError("invalid_outbound_group");
    }
    assertSafeObjectKeys(child);
  }
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCommand(command: unknown): WhatsAppOutboundCommand {
  if (!command || typeof command !== "object") {
    throw new WhatsAppOutboundError("unsupported_command");
  }
  const record = command as Record<string, unknown>;
  if (record.type === "agent_reply") {
    if (!requiredString(record.to) || !requiredString(record.replyText)) {
      throw new WhatsAppOutboundError("invalid_outbound_group");
    }
    return command as WhatsAppOutboundCommand;
  }
  if (record.type === "confirmed_order_receipt") {
    if (!requiredString(record.to) || !requiredString(record.confirmedOrderId)) {
      throw new WhatsAppOutboundError("invalid_outbound_group");
    }
    return command as WhatsAppOutboundCommand;
  }
  if (record.type === "runtime_receipt_document") {
    const runtimeDispatch = record.runtimeDispatch as Record<string, unknown> | undefined;
    if (
      !requiredString(record.to) ||
      !requiredString(record.filePath) ||
      !requiredString(record.filename) ||
      !requiredString(record.caption) ||
      !runtimeDispatch ||
      !requiredString(runtimeDispatch.sellerId) ||
      !requiredString(runtimeDispatch.conversationKey) ||
      !requiredString(runtimeDispatch.customerPhone) ||
      !requiredString(runtimeDispatch.productId) ||
      !requiredString(runtimeDispatch.snapshotId) ||
      !requiredString(runtimeDispatch.publicOrderCode)
    ) {
      throw new WhatsAppOutboundError("missing_artifact_reference");
    }
    return command as WhatsAppOutboundCommand;
  }
  throw new WhatsAppOutboundError("unsupported_command");
}

export function validateWhatsAppOutboundResponseGroup(data: unknown): WhatsAppOutboundResponseGroup {
  if (!data || typeof data !== "object") {
    throw new WhatsAppOutboundError("invalid_outbound_group");
  }
  assertSafeObjectKeys(data);
  const record = data as Record<string, unknown>;
  if (record.schemaVersion !== WHATSAPP_OUTBOUND_SCHEMA_VERSION) {
    throw new WhatsAppOutboundError("unsupported_outbound_schema");
  }
  const recipient = record.recipient as Record<string, unknown> | undefined;
  const source = record.source as Record<string, unknown> | undefined;
  if (
    !requiredString(record.sellerId) ||
    !requiredString(record.conversationKey) ||
    !recipient ||
    !requiredString(recipient.waId) ||
    !source ||
    !requiredString(source.type) ||
    !requiredString(source.id) ||
    !requiredString(record.responseGroupId) ||
    !requiredString(record.responseGroupRole) ||
    !requiredString(record.createdAt) ||
    !Array.isArray(record.commands) ||
    record.commands.length < 1 ||
    record.commands.length > WHATSAPP_OUTBOUND_MAX_COMMANDS
  ) {
    throw new WhatsAppOutboundError("invalid_outbound_group");
  }
  const commands = record.commands.map(validateCommand);
  return {
    ...(record as Omit<WhatsAppOutboundResponseGroup, "commands">),
    commands,
  } as WhatsAppOutboundResponseGroup;
}
