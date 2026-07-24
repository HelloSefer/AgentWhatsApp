import type { QueueDefinition, QueueRegistry } from "../../../../infrastructure/queue";
import { buildWhatsAppOutboundJobId } from "./whatsapp-outbound-job-id";
import type {
  WhatsAppOutboundGroupDispatchResult,
  WhatsAppOutboundGroupDispatcher,
  WhatsAppOutboundJobData,
  WhatsAppOutboundJobName,
  WhatsAppOutboundJobResult,
  WhatsAppOutboundResponseGroup,
} from "./whatsapp-outbound-job.types";
import { whatsappOutboundJobOptions, whatsappOutboundQueueDefinition } from "./whatsapp-outbound-queue.definition";
import { validateWhatsAppOutboundResponseGroup } from "./whatsapp-outbound-validation";
import { WhatsAppOutboundError } from "./whatsapp-outbound.errors";

export class WhatsAppOutboundProducerService implements WhatsAppOutboundGroupDispatcher {
  constructor(
    private readonly registry: QueueRegistry,
    private readonly queueDefinition: QueueDefinition<
      WhatsAppOutboundJobName,
      WhatsAppOutboundJobData,
      WhatsAppOutboundJobResult
    > = whatsappOutboundQueueDefinition,
  ) {}

  async dispatchOutboundGroup(
    input: WhatsAppOutboundResponseGroup,
  ): Promise<WhatsAppOutboundGroupDispatchResult> {
    const group = validateWhatsAppOutboundResponseGroup(input);
    const jobId = buildWhatsAppOutboundJobId(group);

    try {
      const queue = this.registry.getQueue<WhatsAppOutboundJobData, WhatsAppOutboundJobResult, WhatsAppOutboundJobName>(
        this.queueDefinition.name,
      );
      const existingJob = await queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === "waiting" || state === "active" || state === "delayed" || state === "completed") {
          return { accepted: true, duplicate: true, jobId };
        }
      }
      await queue.add("whatsapp-outbound.dispatch", group, {
        ...whatsappOutboundJobOptions(),
        jobId,
      });
      return { accepted: true, duplicate: false, jobId };
    } catch (error) {
      if (error instanceof WhatsAppOutboundError) throw error;
      throw new WhatsAppOutboundError("outbound_enqueue_failed", error);
    }
  }
}
