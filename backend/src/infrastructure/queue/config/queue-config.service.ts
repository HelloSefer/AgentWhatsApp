import { QueueConfigurationError } from "../errors/queue.errors";

export type QueueConfiguration = Readonly<{
  connectionUrl: string;
  keyPrefix: string;
}>;

export const QUEUE_KEY_PREFIX = "agentwhatsapp:bullmq";

const VALKEY_PROTOCOLS = new Set(["redis:", "rediss:"]);

export function validateQueueValkeyUrl(value: unknown): QueueConfiguration {
  if (typeof value !== "string" || !value.trim()) {
    throw new QueueConfigurationError("configuration_unavailable");
  }

  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (!VALKEY_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
      throw new QueueConfigurationError("configuration_invalid");
    }
    return { connectionUrl: trimmed, keyPrefix: QUEUE_KEY_PREFIX };
  } catch (error) {
    if (error instanceof QueueConfigurationError) throw error;
    throw new QueueConfigurationError("configuration_invalid");
  }
}

/** Reads the existing VALKEY_URL source lazily and intentionally refuses env.ts defaults. */
export function getQueueConfiguration(): QueueConfiguration {
  return validateQueueValkeyUrl(process.env.VALKEY_URL);
}
