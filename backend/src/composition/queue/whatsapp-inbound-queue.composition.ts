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
import {
  buildWhatsAppPhase8RuntimeReadiness,
  getWhatsAppPhase8EffectiveFlags,
  type WhatsAppPhase8RuntimeReadiness,
} from "./whatsapp-phase8-runtime-readiness";

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
let starting: Promise<void> | undefined;
const lifecycleEvents: string[] = [];

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

export function getWhatsAppRuntimeLifecycleEvents(): readonly string[] {
  return [...lifecycleEvents];
}

export function clearWhatsAppRuntimeLifecycleEventsForTesting(): void {
  lifecycleEvents.length = 0;
}

export async function startWhatsAppInboundQueue(): Promise<void> {
  if (env.whatsappInboundQueueEnabled !== true) return;
  if (started) return;
  if (starting) return starting;

  starting = (async () => {
    const effectiveFlags = getWhatsAppPhase8EffectiveFlags();
    const readiness = await buildWhatsAppPhase8RuntimeReadiness();
    const startupReady =
      readiness.dependencyIssues.length === 0 &&
      readiness.checks.valkey.ok &&
      readiness.checks.inboundQueue.ok &&
      readiness.checks.cloudRouting.ok &&
      (!effectiveFlags.outboundQueue || readiness.checks.outboundQueue.ok) &&
      (!effectiveFlags.transactionalOutbox || (
        readiness.checks.postgres.ok &&
        readiness.checks.migration0005.ok &&
        readiness.checks.transactionalOutbox.ok
      ));
    if (!startupReady) {
      throw new WhatsAppPhase8RuntimeStartupError(readiness);
    }
    connectionManager = new QueueConnectionManager();
    registry = new QueueRegistry(connectionManager);
    registry.register(whatsappInboundQueueDefinition);
    if (env.whatsappQueueRetriesDlqEnabled === true && effectiveFlags.retriesDlq) {
      registry.register(whatsappInboundDlqDefinition);
      inboundDlqPublisher = new WhatsAppDlqPublisher(registry, whatsappInboundDlqDefinition);
    }
    if (env.whatsappOutboundQueueEnabled === true) {
      if (effectiveFlags.outboundQueue) {
        registry.register(whatsappOutboundQueueDefinition);
        if (env.whatsappQueueRetriesDlqEnabled === true && effectiveFlags.retriesDlq) {
          registry.register(whatsappOutboundDlqDefinition);
          outboundDlqPublisher = new WhatsAppDlqPublisher(registry, whatsappOutboundDlqDefinition);
        }
      }
    }
    orderingCoordinator =
      env.whatsappConversationOrderingEnabled === true
        ? new ValkeyConversationOrderingAdapter()
        : undefined;
    producer = new WhatsAppInboundProducerService(registry, orderingCoordinator);
    outboundProducer = env.whatsappOutboundQueueEnabled === true && effectiveFlags.outboundQueue
      ? new WhatsAppOutboundProducerService(registry)
      : undefined;
    outboundWorker = env.whatsappOutboundQueueEnabled === true && effectiveFlags.outboundQueue
      ? createWhatsAppOutboundWorker(connectionManager, { concurrency: 4, dlqPublisher: outboundDlqPublisher })
      : undefined;
    worker = createWhatsAppInboundWorker(connectionManager, orderingCoordinator, {
      concurrency: effectiveFlags.conversationOrdering ? 8 : undefined,
      groupDispatcher: outboundProducer,
      dlqPublisher: inboundDlqPublisher,
      maxAttempts: WHATSAPP_INBOUND_RETRY_ATTEMPTS,
    });

    try {
      if (outboundWorker) {
        await outboundWorker.start();
        lifecycleEvents.push("start:outbound-worker");
      }
      if (isWhatsAppTransactionalOutboxEffective() && outboundProducer) {
        outboxPublisher = new WhatsAppTransactionalOutboxPublisher(
          new WhatsAppTransactionalOutboxRepository(),
          outboundProducer,
        );
        outboxPublisher.start();
        lifecycleEvents.push("start:transactional-outbox-publisher");
      }
      await worker.start();
      lifecycleEvents.push("start:inbound-worker");
      started = true;
    } catch (error) {
      await shutdownWhatsAppInboundQueue();
      throw error;
    }
  })().finally(() => {
    starting = undefined;
  });
  return starting;
}

export async function shutdownWhatsAppInboundQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    lifecycleEvents.push("stop:inbound-worker");
    worker = undefined;
  }

  if (outboxPublisher) {
    await outboxPublisher.stop();
    lifecycleEvents.push("stop:transactional-outbox-publisher");
    outboxPublisher = undefined;
  }

  if (outboundWorker) {
    await outboundWorker.close();
    lifecycleEvents.push("stop:outbound-worker");
    outboundWorker = undefined;
  }

  if (connectionManager) {
    await connectionManager.closeInitializedResources();
    lifecycleEvents.push("stop:queue-resources");
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

export class WhatsAppPhase8RuntimeStartupError extends Error {
  constructor(readonly readiness: WhatsAppPhase8RuntimeReadiness) {
    super("whatsapp_phase8_runtime_not_ready");
    this.name = "WhatsAppPhase8RuntimeStartupError";
  }
}
