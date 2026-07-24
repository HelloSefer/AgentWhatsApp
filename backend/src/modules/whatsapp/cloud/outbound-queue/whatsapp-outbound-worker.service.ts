import type { QueueConnectionManager, QueueDefinition, QueueJobProcessor } from "../../../../infrastructure/queue";
import { createManagedQueueWorker, type ManagedQueueWorker } from "../../../../infrastructure/queue";
import { dispatchPreparedOutboundGroupDirectly } from "../whatsapp-cloud.service";
import type {
  WhatsAppOutboundJobData,
  WhatsAppOutboundJobName,
  WhatsAppOutboundJobResult,
} from "./whatsapp-outbound-job.types";
import { whatsappOutboundQueueDefinition } from "./whatsapp-outbound-queue.definition";
import { validateWhatsAppOutboundResponseGroup } from "./whatsapp-outbound-validation";
import { WhatsAppOutboundError } from "./whatsapp-outbound.errors";

function maskRecipient(value: string): string {
  return value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-3)}` : "***";
}

function createOutboundProcessor(): QueueJobProcessor<WhatsAppOutboundJobData, WhatsAppOutboundJobResult> {
  return async (job): Promise<WhatsAppOutboundJobResult> => {
    const group = validateWhatsAppOutboundResponseGroup(job.data);
    console.log(JSON.stringify({
      event: "whatsapp.outbound_queue.dispatch_started",
      jobId: job.id,
      sellerId: group.sellerId,
      recipient: maskRecipient(group.recipient.waId),
      commandCount: group.commands.length,
    }));
    const dispatchResult = await dispatchPreparedOutboundGroupDirectly(group);
    const commandResults = dispatchResult.commandResults || [];
    const failed = commandResults.find((result) => !result.ok);
    if (failed) {
      throw new WhatsAppOutboundError("outbound_transport_failed");
    }
    return {
      ok: true,
      commandCount: group.commands.length,
      commandResults,
    };
  };
}

export function createWhatsAppOutboundWorker(
  connectionManager: QueueConnectionManager,
  options: Readonly<{ concurrency?: number }> = {},
  queueDefinition: QueueDefinition<WhatsAppOutboundJobName, WhatsAppOutboundJobData, WhatsAppOutboundJobResult> = whatsappOutboundQueueDefinition,
): ManagedQueueWorker {
  return createManagedQueueWorker(
    queueDefinition,
    createOutboundProcessor(),
    connectionManager,
    options,
  );
}
