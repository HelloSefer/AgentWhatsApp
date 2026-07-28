import type { QueueConnectionManager, QueueDefinition, QueueJobProcessor } from "../../../../infrastructure/queue";
import { createManagedQueueWorker, type ManagedQueueWorker } from "../../../../infrastructure/queue";
import { dispatchPreparedOutboundGroupDirectly } from "../whatsapp-cloud.service";
import type { WhatsAppDlqPublisher } from "../queue-reliability/whatsapp-dlq.publisher";
import type {
  WhatsAppOutboundJobData,
  WhatsAppOutboundJobName,
  WhatsAppOutboundJobResult,
} from "./whatsapp-outbound-job.types";
import { whatsappOutboundQueueDefinition } from "./whatsapp-outbound-queue.definition";
import { validateWhatsAppOutboundResponseGroup } from "./whatsapp-outbound-validation";
import { WhatsAppOutboundError } from "./whatsapp-outbound.errors";
import type { WhatsAppOutboundConnectionResolver } from "../outbound-connection/whatsapp-outbound-connection-resolver";
import {
  handleOutboundFailure,
  validateOutboundProgress,
} from "./whatsapp-outbound-reliability";

function maskRecipient(value: string): string {
  return value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-3)}` : "***";
}

function isPermanentTransportFailure(error: string | undefined): boolean {
  if (!error) return false;
  return /Cloud (?:API|media upload) returned 4\d\d|WHATSAPP_CLOUD_ACCESS_TOKEN is required/iu.test(error);
}

function createOutboundProcessor(
  options: Readonly<{
    dlqPublisher?: WhatsAppDlqPublisher;
    outboundConnectionResolver: WhatsAppOutboundConnectionResolver;
  }>,
): QueueJobProcessor<WhatsAppOutboundJobData, WhatsAppOutboundJobResult> {
  return async (job): Promise<WhatsAppOutboundJobResult> => {
    let failedCommand: Readonly<{ index: number; type: WhatsAppOutboundJobData["commands"][number]["type"] }> | undefined;
    try {
      const group = validateWhatsAppOutboundResponseGroup(job.data);
      const progress = validateOutboundProgress(job.progress, group.commands.length);
      console.log(JSON.stringify({
        event: "whatsapp.outbound_queue.dispatch_started",
        jobId: job.id,
        sellerId: group.sellerId,
        recipient: maskRecipient(group.recipient.waId),
        commandCount: group.commands.length,
        startCommandIndex: progress.nextCommandIndex,
      }));
      const dispatchResult = await dispatchPreparedOutboundGroupDirectly(group, {
        startCommandIndex: progress.nextCommandIndex,
        outboundConnectionResolver: options.outboundConnectionResolver,
        onCommandSuccess: async (nextCommandIndex) => {
          await job.updateProgress({ schemaVersion: 1, nextCommandIndex });
        },
      });
      const commandResults = dispatchResult.commandResults || [];
      const failedOffset = commandResults.findIndex((result) => !result.ok);
      if (failedOffset >= 0) {
        const index = progress.nextCommandIndex + failedOffset;
        failedCommand = {
          index,
          type: group.commands[index]?.type || commandResults[failedOffset].type,
        };
        throw new WhatsAppOutboundError(
          isPermanentTransportFailure(commandResults[failedOffset].error)
            ? "outbound_transport_permanent_failed"
            : "outbound_transport_failed",
        );
      }
      return {
        ok: true,
        commandCount: group.commands.length,
        commandResults,
      };
    } catch (error) {
      if (options.dlqPublisher) {
        return handleOutboundFailure(job, error, options.dlqPublisher, failedCommand);
      }
      throw error;
    }
  };
}

export function createWhatsAppOutboundWorker(
  connectionManager: QueueConnectionManager,
  options: Readonly<{
    concurrency?: number;
    dlqPublisher?: WhatsAppDlqPublisher;
    outboundConnectionResolver: WhatsAppOutboundConnectionResolver;
  }>,
  queueDefinition: QueueDefinition<WhatsAppOutboundJobName, WhatsAppOutboundJobData, WhatsAppOutboundJobResult> = whatsappOutboundQueueDefinition,
): ManagedQueueWorker {
  return createManagedQueueWorker(
    queueDefinition,
    createOutboundProcessor({
      dlqPublisher: options.dlqPublisher,
      outboundConnectionResolver: options.outboundConnectionResolver,
    }),
    connectionManager,
    options,
  );
}
