import { env } from "../../config/env";
import {
  QueueConnectionManager,
  QueueRegistry,
  shutdownQueueInfrastructure,
} from "../../infrastructure/queue";
import { whatsappInboundQueueDefinition } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition";
import { whatsappInboundDlqDefinition } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-dlq.definition";
import { WhatsAppInboundProducerService } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-producer.service";
import { createWhatsAppInboundWorker } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-worker.service";
import { WHATSAPP_INBOUND_RETRY_ATTEMPTS } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition";
import { whatsappOutboundQueueDefinition } from "../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-queue.definition";
import { whatsappOutboundDlqDefinition } from "../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-dlq.definition";
import { WhatsAppOutboundProducerService } from "../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-producer.service";
import { createWhatsAppOutboundWorker } from "../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-worker.service";
import { WhatsAppTransactionalOutboxPublisher, WhatsAppTransactionalOutboxRepository } from "../../modules/whatsapp/cloud/transactional-outbox";
import { ValkeyConversationOrderingAdapter } from "../../modules/agent/conversation-ordering";
import { WhatsAppDlqPublisher } from "../../modules/whatsapp/cloud/queue-reliability/whatsapp-dlq.publisher";
import { isWhatsAppTransactionalOutboxEffective } from "../runtime-write/runtime-write-composition.runtime";

let connectionManager: QueueConnectionManager | undefined;
let registry: QueueRegistry | undefined;
let producer: WhatsAppInboundProducerService | undefined;
let worker: ReturnType<typeof createWhatsAppInboundWorker> | undefined;
let outboundProducer: WhatsAppOutboundProducerService | undefined;
let outboundWorker: ReturnType<typeof createWhatsAppOutboundWorker> | undefined;
let outboxPublisher: WhatsAppTransactionalOutboxPublisher | undefined;
let orderingCoordinator: ValkeyConversationOrderingAdapter | undefined;
let inboundDlqPublisher: WhatsAppDlqPublisher | undefined;
let outboundDlqPublisher: WhatsAppDlqPublisher | undefined;
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

export function getWhatsAppOutboundProducer(): WhatsAppOutboundProducerService | undefined {
  return outboundProducer;
}

export function getWhatsAppTransactionalOutboxPublisher(): WhatsAppTransactionalOutboxPublisher | undefined {
  return outboxPublisher;
}

export async function startWhatsAppInboundQueue(): Promise<void> {
  if (env.whatsappInboundQueueEnabled !== true) return;
  if (started) return;

  connectionManager = new QueueConnectionManager();
  registry = new QueueRegistry(connectionManager);
  registry.register(whatsappInboundQueueDefinition);
  if (env.whatsappQueueRetriesDlqEnabled === true) {
    registry.register(whatsappInboundDlqDefinition);
    inboundDlqPublisher = new WhatsAppDlqPublisher(registry, whatsappInboundDlqDefinition);
  }
  if (env.whatsappOutboundQueueEnabled === true) {
    registry.register(whatsappOutboundQueueDefinition);
    if (env.whatsappQueueRetriesDlqEnabled === true) {
      registry.register(whatsappOutboundDlqDefinition);
      outboundDlqPublisher = new WhatsAppDlqPublisher(registry, whatsappOutboundDlqDefinition);
    }
  }
  orderingCoordinator =
    env.whatsappConversationOrderingEnabled === true
      ? new ValkeyConversationOrderingAdapter()
      : undefined;
  producer = new WhatsAppInboundProducerService(registry, orderingCoordinator);
  outboundProducer = env.whatsappOutboundQueueEnabled === true
    ? new WhatsAppOutboundProducerService(registry)
    : undefined;
  outboundWorker = env.whatsappOutboundQueueEnabled === true
    ? createWhatsAppOutboundWorker(connectionManager, { concurrency: 4, dlqPublisher: outboundDlqPublisher })
    : undefined;
  worker = createWhatsAppInboundWorker(connectionManager, orderingCoordinator, {
    concurrency: env.whatsappConversationOrderingEnabled === true ? 8 : undefined,
    groupDispatcher: outboundProducer,
    dlqPublisher: inboundDlqPublisher,
    maxAttempts: WHATSAPP_INBOUND_RETRY_ATTEMPTS,
  });
  if (outboundWorker) {
    await outboundWorker.start();
  }
  if (isWhatsAppTransactionalOutboxEffective() && outboundProducer) {
    outboxPublisher = new WhatsAppTransactionalOutboxPublisher(
      new WhatsAppTransactionalOutboxRepository(),
      outboundProducer,
    );
    outboxPublisher.start();
  }
  await worker.start();
  started = true;
}

export async function shutdownWhatsAppInboundQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }

  if (outboxPublisher) {
    await outboxPublisher.stop();
    outboxPublisher = undefined;
  }

  if (outboundWorker) {
    await outboundWorker.close();
    outboundWorker = undefined;
  }

  if (connectionManager) {
    await connectionManager.closeInitializedResources();
    connectionManager = undefined;
  }

  await shutdownQueueInfrastructure();

  registry = undefined;
  producer = undefined;
  outboundProducer = undefined;
  inboundDlqPublisher = undefined;
  outboundDlqPublisher = undefined;
  orderingCoordinator = undefined;
  started = false;
}

export function isWhatsAppInboundQueueStarted(): boolean {
  return started;
}
