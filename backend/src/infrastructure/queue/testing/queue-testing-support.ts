import type { QueueDefinition } from "../contracts/queue.types";

export type Phase8ATestJobName = "phase8a.trivial";

export type Phase8ATestJobData = Readonly<{
  value: string;
}>;

export type Phase8ATestJobResult = Readonly<{
  processedValue: string;
}>;

export function createPhase8ATestQueueDefinition(suffix: string): QueueDefinition<
  Phase8ATestJobName,
  Phase8ATestJobData,
  Phase8ATestJobResult
> {
  return {
    name: `phase8a-test-${suffix}`,
    jobNames: ["phase8a.trivial"],
  };
}
