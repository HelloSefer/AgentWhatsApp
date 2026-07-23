import IORedis, { type Redis } from "ioredis";
import { getQueueConfiguration } from "../config/queue-config.service";
import type { QueueLifecycleState, QueueResource } from "../contracts/queue.types";
import { QueueConnectionError } from "../errors/queue.errors";

export type QueueConnectionRole = "queue" | "worker" | "blocking" | "events" | "health";

type ManagedConnection = Readonly<{
  role: QueueConnectionRole;
  connection: Redis;
}>;

export class QueueConnectionManager {
  private readonly connections: ManagedConnection[] = [];
  private readonly resources: QueueResource[] = [];
  private workerCount = 0;
  private closed = false;

  createConnection(role: QueueConnectionRole): Redis {
    if (this.closed) throw new QueueConnectionError();
    const configuration = getQueueConfiguration();
    const connection = new IORedis(configuration.connectionUrl, {
      lazyConnect: true,
      keyPrefix: undefined,
      maxRetriesPerRequest: role === "worker" || role === "blocking" || role === "events" ? null : 1,
      connectTimeout: 3_000,
      enableReadyCheck: true,
      retryStrategy: () => null,
    });
    connection.on("error", () => undefined);
    this.connections.push({ role, connection });
    return connection;
  }

  trackResource(resource: QueueResource): void {
    if (this.closed) throw new QueueConnectionError();
    this.resources.push(resource);
  }

  trackWorker(resource: QueueResource): void {
    this.workerCount += 1;
    this.trackResource(resource);
  }

  getState(): QueueLifecycleState {
    return {
      initialized: this.connections.length > 0 || this.resources.length > 0,
      closed: this.closed,
      resourceCount: this.resources.length,
      workerCount: this.workerCount,
      connectionCount: this.connections.length,
    };
  }

  async closeInitializedResources(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const resource of [...this.resources].reverse()) {
      try {
        await withTimeout(resource.close(), 5_000);
      } catch {
        // Shutdown is best-effort and public-safe; callers can inspect state.
      }
    }

    for (const managed of [...this.connections].reverse()) {
      try {
        if (managed.connection.status === "end") continue;
        if (managed.connection.status === "wait" || managed.connection.status === "close") {
          managed.connection.disconnect();
        } else {
          await withTimeout(managed.connection.quit(), 5_000);
        }
      } catch {
        managed.connection.disconnect();
      }
    }

    this.resources.length = 0;
    this.connections.length = 0;
    this.workerCount = 0;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("queue_shutdown_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const defaultQueueConnectionManager = new QueueConnectionManager();

export function getDefaultQueueConnectionManager(): QueueConnectionManager {
  return defaultQueueConnectionManager;
}

export function getQueueConnectionState(): QueueLifecycleState {
  return defaultQueueConnectionManager.getState();
}

export async function shutdownQueueInfrastructure(): Promise<void> {
  await defaultQueueConnectionManager.closeInitializedResources();
}
