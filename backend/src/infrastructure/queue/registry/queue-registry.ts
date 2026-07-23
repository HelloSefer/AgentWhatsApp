import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import { getQueueConfiguration } from "../config/queue-config.service";
import type { QueueDefinition } from "../contracts/queue.types";
import { QueueConnectionManager, getDefaultQueueConnectionManager } from "../connection/queue-connection-manager";
import { QueueRegistrationError } from "../errors/queue.errors";

const QUEUE_NAME_PATTERN = /^[a-z][a-z0-9-]{2,63}$/u;

export class QueueRegistry {
  private readonly definitions = new Map<string, QueueDefinition<string, Record<string, unknown>, unknown>>();
  private readonly queues = new Map<string, Queue<Record<string, unknown>, unknown, string>>();

  constructor(private readonly connectionManager: QueueConnectionManager = getDefaultQueueConnectionManager()) {}

  register<TJobName extends string, TData extends Record<string, unknown>, TResult>(
    definition: QueueDefinition<TJobName, TData, TResult>,
  ): void {
    validateQueueName(definition.name);
    if (this.definitions.has(definition.name)) throw new QueueRegistrationError("duplicate_registration");
    this.definitions.set(definition.name, definition as QueueDefinition<string, Record<string, unknown>, unknown>);
  }

  getQueue<TData extends Record<string, unknown>, TResult = unknown, TJobName extends string = string>(
    name: string,
  ): Queue<TData, TResult, TJobName> {
    const definition = this.definitions.get(name);
    if (!definition) throw new QueueRegistrationError("queue_not_registered");

    const existing = this.queues.get(name);
    if (existing) return existing as Queue<TData, TResult, TJobName>;

    const configuration = getQueueConfiguration();
    const options: QueueOptions = {
      connection: this.connectionManager.createConnection("queue"),
      prefix: configuration.keyPrefix,
    };
    const queue = new Queue<Record<string, unknown>, unknown, string>(definition.name, options);
    queue.on("error", () => undefined);
    this.connectionManager.trackResource({ close: () => queue.close() });
    this.queues.set(name, queue);
    return queue as Queue<TData, TResult, TJobName>;
  }

  listRegisteredQueueNames(): readonly string[] {
    return [...this.definitions.keys()].sort();
  }

  getManagedQueueCount(): number {
    return this.queues.size;
  }
}

export function validateQueueName(name: unknown): string {
  if (
    typeof name !== "string" ||
    !QUEUE_NAME_PATTERN.test(name)
  ) {
    throw new QueueRegistrationError("invalid_queue_name");
  }
  return name;
}

export function defaultJobOptions(): JobsOptions {
  return {
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  };
}
