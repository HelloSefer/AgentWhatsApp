import { env } from "../../config/env";
import {
  QueueConnectionManager,
  QueueRegistry,
  shutdownQueueInfrastructure,
} from "../../infrastructure/queue";
import { whatsappInboundQueueDefinition } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition";
import { WhatsAppInboundProducerService } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service";
import { createWhatsAppInboundWorker } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service";
import { ValkeyConversationOrderingAdapter } from "../../modules/agent/conversation-ordering";

let connectionManager: QueueConnectionManager | undefined;
let registry: QueueRegistry | undefined;
let producer: WhatsAppInboundProducerService | undefined;
let worker: ReturnType<typeof createWhatsAppInboundWorker> | undefined;
let orderingCoordinator: ValkeyConversationOrderingAdapter | undefined;
let started = false;

export function getWhatsAppInboundProducer(): WhatsAppInboundProducerService | undefined {
  return producer;
}

export function getWhatsAppInboundRegistry(): QueueRegistry | undefined {
  return registry;
}

export function getWhatsAppInboundConnectionManager(): QueueConnectionManager | undefined {
  return connectionManager;
}

export function getWhatsAppConversationOrderingCoordinator(): ValkeyConversationOrderingAdapter | undefined {
  return orderingCoordinator;
}

export async function startWhatsAppInboundQueue(): Promise<void> {
  if (env.whatsappInboundQueueEnabled !== true) return;
  if (started) return;

  connectionManager = new QueueConnectionManager();
  registry = new QueueRegistry(connectionManager);
  registry.register(whatsappInboundQueueDefinition);
  orderingCoordinator =
    env.whatsappConversationOrderingEnabled === true
      ? new ValkeyConversationOrderingAdapter()
      : undefined;
  producer = new WhatsAppInboundProducerService(registry, orderingCoordinator);
  worker = createWhatsAppInboundWorker(connectionManager, orderingCoordinator, {
    concurrency: env.whatsappConversationOrderingEnabled === true ? 8 : undefined,
  });
  await worker.start();
  started = true;
}

export async function shutdownWhatsAppInboundQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }

  if (connectionManager) {
    await connectionManager.closeInitializedResources();
    connectionManager = undefined;
  }

  await shutdownQueueInfrastructure();

  registry = undefined;
  producer = undefined;
  orderingCoordinator = undefined;
  started = false;
}

export function isWhatsAppInboundQueueStarted(): boolean {
  return started;
}
