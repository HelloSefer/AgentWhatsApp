import { env } from "../../config/env";
import { getDatabaseHealth } from "../../infrastructure/database/health/database-health.service";
import { getDatabaseMigrationStatus } from "../../infrastructure/database/migrations/migration-runner.service";
import type { MigrationStatus } from "../../infrastructure/database/migrations/migration.types";
import { QueueConnectionManager, QueueRegistry, getQueueConnectionState } from "../../infrastructure/queue";
import { getQueueHealth } from "../../infrastructure/queue/health/queue-health.service";
import { whatsappInboundQueueDefinition } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition";
import { whatsappOutboundQueueDefinition } from "../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-queue.definition";
import { WHATSAPP_INBOUND_RETRY_ATTEMPTS } from "../../modules/whatsapp/cloud/inbound-queue/whatsapp-inbound-queue.definition";
import { WHATSAPP_OUTBOUND_RETRY_ATTEMPTS } from "../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-queue.definition";
import { WhatsAppTransactionalOutboxRepository } from "../../modules/whatsapp/cloud/transactional-outbox";
import { getWhatsAppConnectionCredentialEncryptionConfiguration } from "../../modules/whatsapp-connection/application/whatsapp-connection-credential-encryption.config";

export type WhatsAppPhase8EffectiveFlags = Readonly<{
  inboundQueue: boolean;
  conversationOrdering: boolean;
  outboundQueue: boolean;
  retriesDlq: boolean;
  transactionalOutbox: boolean;
  completeQueuedRuntime: boolean;
}>;

export type WhatsAppPhase8ReadinessCheck = Readonly<{
  ok: boolean;
  category: string;
}>;

export type WhatsAppPhase8RuntimeReadiness = Readonly<{
  status: "ready" | "not_ready" | "disabled";
  effectiveFlags: WhatsAppPhase8EffectiveFlags;
  dependencyIssues: readonly string[];
  checks: Readonly<{
    postgres: WhatsAppPhase8ReadinessCheck;
    migration0005: WhatsAppPhase8ReadinessCheck;
    valkey: WhatsAppPhase8ReadinessCheck;
    inboundQueue: WhatsAppPhase8ReadinessCheck;
    conversationOrdering: WhatsAppPhase8ReadinessCheck;
    outboundQueue: WhatsAppPhase8ReadinessCheck;
    retriesDlq: WhatsAppPhase8ReadinessCheck;
    transactionalOutbox: WhatsAppPhase8ReadinessCheck;
    cloudRouting: WhatsAppPhase8ReadinessCheck;
    importSideEffects: WhatsAppPhase8ReadinessCheck;
    flagMatrix: WhatsAppPhase8ReadinessCheck;
  }>;
}>;

export function getWhatsAppPhase8EffectiveFlags(): WhatsAppPhase8EffectiveFlags {
  const inboundQueue = env.whatsappInboundQueueEnabled === true;
  const outboundQueue = inboundQueue && env.whatsappOutboundQueueEnabled === true;
  const conversationOrdering = inboundQueue && env.whatsappConversationOrderingEnabled === true;
  const retriesDlq = inboundQueue && env.whatsappQueueRetriesDlqEnabled === true;
  const transactionalOutbox =
    inboundQueue &&
    outboundQueue &&
    env.whatsappTransactionalOutboxEnabled === true;

  return {
    inboundQueue,
    conversationOrdering,
    outboundQueue,
    retriesDlq,
    transactionalOutbox,
    completeQueuedRuntime:
      inboundQueue &&
      conversationOrdering &&
      outboundQueue &&
      retriesDlq &&
      transactionalOutbox,
  };
}

export function getWhatsAppPhase8FlagDependencyIssues(): readonly string[] {
  const issues: string[] = [];
  if (env.whatsappConversationOrderingEnabled === true && env.whatsappInboundQueueEnabled !== true) {
    issues.push("conversation_ordering_requires_inbound_queue");
  }
  if (env.whatsappOutboundQueueEnabled === true && env.whatsappInboundQueueEnabled !== true) {
    issues.push("outbound_queue_requires_inbound_queue");
  }
  if (env.whatsappTransactionalOutboxEnabled === true) {
    if (env.whatsappInboundQueueEnabled !== true) {
      issues.push("transactional_outbox_requires_inbound_queue");
    }
    if (env.whatsappOutboundQueueEnabled !== true) {
      issues.push("transactional_outbox_requires_outbound_queue");
    }
  }
  return issues;
}

function ok(category = "available"): WhatsAppPhase8ReadinessCheck {
  return { ok: true, category };
}

function fail(category: string): WhatsAppPhase8ReadinessCheck {
  return { ok: false, category };
}

function safeCategory(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return "unavailable";
}

async function queueConstructible(name: "inbound" | "outbound"): Promise<WhatsAppPhase8ReadinessCheck> {
  const manager = new QueueConnectionManager();
  const registry = new QueueRegistry(manager);
  try {
    registry.register(name === "inbound" ? whatsappInboundQueueDefinition : whatsappOutboundQueueDefinition);
    const queue = registry.getQueue(name === "inbound" ? whatsappInboundQueueDefinition.name : whatsappOutboundQueueDefinition.name);
    await queue.waitUntilReady();
    await manager.closeInitializedResources();
    return ok("constructible");
  } catch (error) {
    await manager.closeInitializedResources();
    return fail(safeCategory(error));
  }
}

function cloudRoutingReady(): WhatsAppPhase8ReadinessCheck {
  if (env.whatsappProvider !== "cloud_api") return fail("unsupported_provider");
  try {
    getWhatsAppConnectionCredentialEncryptionConfiguration();
  } catch {
    return fail("connection_credential_encryption_unavailable");
  }
  return ok("connection_scoped_cloud_api_configured");
}

export async function buildWhatsAppPhase8RuntimeReadiness(): Promise<WhatsAppPhase8RuntimeReadiness> {
  const effectiveFlags = getWhatsAppPhase8EffectiveFlags();
  const dependencyIssues = getWhatsAppPhase8FlagDependencyIssues();
  const defaultSkipped = ok("not_required");
  const importState = getQueueConnectionState();

  if (!effectiveFlags.inboundQueue) {
    return {
      status: dependencyIssues.length ? "not_ready" : "disabled",
      effectiveFlags,
      dependencyIssues,
      checks: {
        postgres: defaultSkipped,
        migration0005: defaultSkipped,
        valkey: defaultSkipped,
        inboundQueue: ok("disabled"),
        conversationOrdering: ok("disabled"),
        outboundQueue: ok("disabled"),
        retriesDlq: ok("disabled"),
        transactionalOutbox: ok("disabled"),
        cloudRouting: cloudRoutingReady(),
        importSideEffects: importState.initialized ? fail("process_lifetime_queue_resource_initialized") : ok("none_detected"),
        flagMatrix: dependencyIssues.length ? fail("invalid_dependencies") : ok("safe"),
      },
    };
  }

  const [
    postgres,
    migration,
    valkey,
    inboundQueue,
    outboundQueue,
  ] = await Promise.all([
    getDatabaseHealth().catch((error) => ({ status: "unavailable" as const, reachable: false, errorCategory: safeCategory(error) })),
    getDatabaseMigrationStatus().catch((): MigrationStatus => ({ metadataReady: false, applied: [], pending: ["0005"] })),
    getQueueHealth(),
    queueConstructible("inbound"),
    effectiveFlags.outboundQueue ? queueConstructible("outbound") : Promise.resolve(ok("disabled")),
  ]);

  const migration0005Applied = migration.applied.includes("0005") && !migration.pending.includes("0005");
  const checks = {
    postgres: postgres.reachable ? ok("reachable") : fail("unreachable"),
    migration0005: migration0005Applied ? ok("applied") : fail("pending_or_missing"),
    valkey: valkey.reachable ? ok("reachable") : fail("unreachable"),
    inboundQueue,
    conversationOrdering: effectiveFlags.conversationOrdering ? ok("adapter_configured") : ok("disabled"),
    outboundQueue,
    retriesDlq: effectiveFlags.retriesDlq && WHATSAPP_INBOUND_RETRY_ATTEMPTS > 1 && WHATSAPP_OUTBOUND_RETRY_ATTEMPTS > 1
      ? ok("valid")
      : effectiveFlags.retriesDlq
        ? fail("invalid")
        : ok("disabled"),
    transactionalOutbox: effectiveFlags.transactionalOutbox && WhatsAppTransactionalOutboxRepository
      ? ok("repository_and_publisher_configurable")
      : effectiveFlags.transactionalOutbox
        ? fail("unavailable")
        : ok("disabled"),
    cloudRouting: cloudRoutingReady(),
    importSideEffects: importState.initialized ? fail("process_lifetime_queue_resource_initialized") : ok("none_detected"),
    flagMatrix: dependencyIssues.length ? fail("invalid_dependencies") : ok("safe"),
  };

  const ready = Object.values(checks).every((check) => check.ok);
  return {
    status: ready ? "ready" : "not_ready",
    effectiveFlags,
    dependencyIssues,
    checks,
  };
}
