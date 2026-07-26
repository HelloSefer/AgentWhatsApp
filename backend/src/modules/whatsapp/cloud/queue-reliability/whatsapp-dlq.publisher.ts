import type { JobsOptions, Queue } from "bullmq";
import type { QueueDefinition, QueueRegistry } from "../../../../infrastructure/queue";
import type { WhatsAppDlqFailureEnvelope } from "./whatsapp-queue-reliability.types";

export const WHATSAPP_DLQ_RETENTION_SECONDS = 604_800;

export type WhatsAppDlqJobName = "whatsapp.dlq.failure";
export type WhatsAppDlqJobResult = Readonly<{ ok: true }>;

export function buildWhatsAppDlqJobId(sourceQueue: string, originalJobId: string): string {
  return `${sourceQueue}--${originalJobId}`;
}

export function whatsappDlqJobOptions(sourceQueue: string, originalJobId: string): JobsOptions {
  return {
    attempts: 1,
    jobId: buildWhatsAppDlqJobId(sourceQueue, originalJobId),
    removeOnComplete: { age: WHATSAPP_DLQ_RETENTION_SECONDS },
    removeOnFail: false,
  };
}

export class WhatsAppDlqPublisher {
  constructor(
    private readonly registry: QueueRegistry,
    private readonly definition: QueueDefinition<WhatsAppDlqJobName, WhatsAppDlqFailureEnvelope, WhatsAppDlqJobResult>,
  ) {}

  async publish(envelope: WhatsAppDlqFailureEnvelope): Promise<void> {
    const queue = this.registry.getQueue<WhatsAppDlqFailureEnvelope, WhatsAppDlqJobResult, WhatsAppDlqJobName>(
      this.definition.name,
    ) as Queue<WhatsAppDlqFailureEnvelope, WhatsAppDlqJobResult, WhatsAppDlqJobName>;
    await queue.add("whatsapp.dlq.failure", envelope, whatsappDlqJobOptions(envelope.sourceQueue, envelope.originalJobId));
  }
}
