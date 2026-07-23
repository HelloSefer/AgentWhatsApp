import { Worker, type WorkerOptions } from "bullmq";
import { getQueueConfiguration } from "../config/queue-config.service";
import { QueueConnectionManager, getDefaultQueueConnectionManager } from "../connection/queue-connection-manager";
import type { QueueDefinition, QueueJobProcessor } from "../contracts/queue.types";
import { QueueWorkerStartupError } from "../errors/queue.errors";

export type ManagedQueueWorker = Readonly<{
  start: () => Promise<void>;
  close: () => Promise<void>;
  isStarted: () => boolean;
}>;

export function createManagedQueueWorker<
  TJobName extends string,
  TData extends Record<string, unknown>,
  TResult,
>(
  definition: QueueDefinition<TJobName, TData, TResult>,
  processor: QueueJobProcessor<TData, TResult>,
  connectionManager: QueueConnectionManager = getDefaultQueueConnectionManager(),
): ManagedQueueWorker {
  let worker: Worker<TData, TResult, TJobName> | undefined;
  let started = false;
  let closed = false;

  function getWorker(): Worker<TData, TResult, TJobName> {
    if (worker) return worker;
    const configuration = getQueueConfiguration();
    const options: WorkerOptions = {
      autorun: false,
      connection: connectionManager.createConnection("worker"),
      prefix: configuration.keyPrefix,
    };
    worker = new Worker<TData, TResult, TJobName>(definition.name, processor, options);
    worker.on("error", () => undefined);
    connectionManager.trackWorker({ close: () => worker?.close() || Promise.resolve() });
    return worker;
  }

  return {
    start: async () => {
      if (closed) throw new QueueWorkerStartupError();
      if (started) return;
      try {
        const activeWorker = getWorker();
        void activeWorker.run().catch(() => undefined);
        await activeWorker.waitUntilReady();
        started = true;
      } catch (error) {
        throw new QueueWorkerStartupError(error);
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      if (!worker) return;
      await worker.close();
    },
    isStarted: () => started && !closed,
  };
}
