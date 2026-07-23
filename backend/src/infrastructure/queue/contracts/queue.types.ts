import type { Job } from "bullmq";

export type QueueDefinition<
  TJobName extends string,
  TData extends Record<string, unknown>,
  TResult = unknown,
> = Readonly<{
  name: string;
  jobNames: readonly TJobName[];
}>;

export type QueueJobProcessor<TData extends Record<string, unknown>, TResult = unknown> = (
  job: Job<TData, TResult, string>,
) => Promise<TResult>;

export type QueueLifecycleState = Readonly<{
  initialized: boolean;
  closed: boolean;
  resourceCount: number;
  workerCount: number;
  connectionCount: number;
}>;

export type QueueHealthStatus = "available" | "unavailable";

export type QueueHealthResult = Readonly<{
  status: QueueHealthStatus;
  reachable: boolean;
  latencyMs?: number;
  errorCategory?: string;
}>;

export type DeterministicJobId = string & { readonly __brand: "DeterministicJobId" };

export type QueueResource = Readonly<{
  close: () => Promise<void>;
}>;
