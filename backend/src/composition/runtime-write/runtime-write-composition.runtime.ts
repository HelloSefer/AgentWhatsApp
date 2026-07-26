import { env } from "../../config/env";
import { createRuntimeWriteComposition } from "./create-runtime-write-composition";
import { WhatsAppTransactionalOutboxRepository } from "../../modules/whatsapp/cloud/transactional-outbox";

export function isWhatsAppTransactionalOutboxEffective(): boolean {
  return env.whatsappTransactionalOutboxEnabled === true &&
    env.whatsappInboundQueueEnabled === true &&
    env.whatsappOutboundQueueEnabled === true;
}

/** One process-lifetime composition; construction performs no database I/O. */
export const runtimeWriteComposition = createRuntimeWriteComposition({
  mode: env.persistenceRuntimeOrderWritesEnabled ? "enabled" : "disabled",
  whatsappTransactionalOutboxAppender: isWhatsAppTransactionalOutboxEffective()
    ? new WhatsAppTransactionalOutboxRepository()
    : undefined,
});
