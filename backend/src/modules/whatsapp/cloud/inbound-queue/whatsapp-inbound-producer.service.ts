import type { QueueRegistry } from "../../../../infrastructure/queue";
import { whatsappInboundQueueDefinition, whatsappInboundJobOptions } from "./whatsapp-inbound-queue.definition";
import { buildWhatsAppInboundJobId } from "./whatsapp-inbound-job-id";
import type { WhatsAppInboundJobData } from "./whatsapp-inbound-job.types";
import { WhatsAppInboundEnqueueError } from "./whatsapp-inbound.errors";

export type WhatsAppInboundEnqueueResult = Readonly<{
  ok: true;
  duplicate: boolean;
  jobId: string;
}>;

export class WhatsAppInboundProducerService {
  constructor(private readonly registry: QueueRegistry) {}

  async enqueueInboundJob(
    data: WhatsAppInboundJobData,
  ): Promise<WhatsAppInboundEnqueueResult> {
    const jobId = buildWhatsAppInboundJobId(data.sellerId, data.messageId);

    try {
      const queue = this.registry.getQueue<WhatsAppInboundJobData>(whatsappInboundQueueDefinition.name);
      const existingJob = await queue.getJob(jobId);

      if (existingJob) {
        const state = await existingJob.getState();
        if (
          state === "waiting" ||
          state === "active" ||
          state === "delayed" ||
          state === "completed"
        ) {
          return { ok: true, duplicate: true, jobId };
        }
      }

      await queue.add("whatsapp-inbound.process", data, {
        ...whatsappInboundJobOptions(),
        jobId,
      });

      return { ok: true, duplicate: false, jobId };
    } catch (error) {
      throw new WhatsAppInboundEnqueueError("enqueue_failed", error);
    }
  }
}
