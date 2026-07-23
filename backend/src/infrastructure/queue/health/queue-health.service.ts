import type { QueueHealthResult } from "../contracts/queue.types";
import { QueueConnectionManager } from "../connection/queue-connection-manager";
import { toQueueErrorCategory } from "../errors/queue.errors";

export async function getQueueHealth(): Promise<QueueHealthResult> {
  const manager = new QueueConnectionManager();
  const started = Date.now();
  try {
    const connection = manager.createConnection("health");
    await connection.connect();
    await connection.ping();
    await manager.closeInitializedResources();
    return {
      status: "available",
      reachable: true,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    await manager.closeInitializedResources();
    return {
      status: "unavailable",
      reachable: false,
      errorCategory: toQueueErrorCategory(error),
    };
  }
}
