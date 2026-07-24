import type { QueueRegistry } from "../../../../infrastructure/queue";
import type { QueueDefinition } from "../../../../infrastructure/queue";
import type { ConversationOrderingCoordinator } from "../../../agent/conversation-ordering";
import { whatsappInboundQueueDefinition, whatsappInboundJobOptions } from "./whatsapp-inbound-queue.definition";
import { buildWhatsAppInboundJobId } from "./whatsapp-inbound-job-id";
import type { WhatsAppInboundJobData, WhatsAppInboundJobDataV2, WhatsAppInboundJobInputData } from "./whatsapp-inbound-job.types";
import { WhatsAppInboundEnqueueError } from "./whatsapp-inbound.errors";

export type WhatsAppInboundEnqueueResult = Readonly<{
  ok: true;
  duplicate: boolean;
  jobId: string;
}>;

export class WhatsAppInboundProducerService {
  constructor(
    private readonly registry: QueueRegistry,
    private readonly orderingCoordinator?: ConversationOrderingCoordinator,
    private readonly queueDefinition: QueueDefinition<"whatsapp-inbound.process", WhatsAppInboundJobData, unknown> = whatsappInboundQueueDefinition,
  ) {}

  async enqueueInboundJob(
    data: WhatsAppInboundJobInputData,
  ): Promise<WhatsAppInboundEnqueueResult> {
    const jobId = buildWhatsAppInboundJobId(data.sellerId, data.messageId);

    try {
      const queue = this.registry.getQueue<WhatsAppInboundJobData>(this.queueDefinition.name);
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

      const coordinator = this.orderingCoordinator;
      const jobData: WhatsAppInboundJobData = coordinator
        ? await (async (): Promise<WhatsAppInboundJobDataV2> => {
            const turn = await coordinator.reserveTurn({
              sellerId: data.sellerId,
              conversationKey: data.conversationKey,
              messageId: data.messageId,
            });
            return {
            ...data,
            schemaVersion: 2 as const,
            ordering: {
              version: 1 as const,
              orderingKey: turn.orderingKey,
              sequence: turn.sequence,
            },
          };
        })()
        : {
            ...data,
            schemaVersion: 1 as const,
          };

      await queue.add("whatsapp-inbound.process", jobData, {
        ...whatsappInboundJobOptions(),
        jobId,
      });

      return { ok: true, duplicate: false, jobId };
    } catch (error) {
      throw new WhatsAppInboundEnqueueError("enqueue_failed", error);
    }
  }
}
