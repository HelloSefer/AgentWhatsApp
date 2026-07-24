import { env } from "../../config/env";
import {
  QueueConnectionManager,
  QueueRegistry,
  shutdownQueueInfrastructure,
} from "../../infrastructure/queue";
import { whatsappInboundQueueDefinition } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition";
import { WhatsAppInboundProducerService } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service";
import { createWhatsAppInboundWorker } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service";

let connectionManager: QueueConnectionManager | undefined;
let registry: QueueRegistry | undefined;
let producer: WhatsAppInboundProducerService | undefined;
let worker: ReturnType<typeof createWhatsAppInboundWorker> | undefined;
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

export async function startWhatsAppInboundQueue(): Promise<void> {
  if (env.whatsappInboundQueueEnabled !== true) return;
  if (started) return;

  connectionManager = new QueueConnectionManager();
  registry = new QueueRegistry(connectionManager);
  registry.register(whatsappInboundQueueDefinition);
  producer = new WhatsAppInboundProducerService(registry);
  worker = createWhatsAppInboundWorker(connectionManager);
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
  started = false;
}

export function isWhatsAppInboundQueueStarted(): boolean {
  return started;
}
