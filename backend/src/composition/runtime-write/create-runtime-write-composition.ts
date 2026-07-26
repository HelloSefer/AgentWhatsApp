import { createPersistenceComposition } from "../persistence/create-persistence-composition";
import type { PersistenceComposition } from "../persistence/persistence-composition.types";
import { RuntimeConfirmedOrderWriter } from "./runtime-confirmed-order-writer";
import { resolveRuntimeOrderWriteMode, type RuntimeOrderWriteMode } from "./runtime-order-write-mode";
import type { WhatsAppTransactionalOutboxAppender } from "../../modules/whatsapp/cloud/transactional-outbox";

export type RuntimeWriteComposition = Readonly<{
  confirmedOrderWriter: RuntimeConfirmedOrderWriter;
}>;

export function createRuntimeWriteComposition(input: Readonly<{
  mode?: RuntimeOrderWriteMode;
  persistence?: PersistenceComposition;
  whatsappTransactionalOutboxAppender?: WhatsAppTransactionalOutboxAppender;
}> = {}): RuntimeWriteComposition {
  const persistence = input.persistence || createPersistenceComposition();
  const mode = input.mode || resolveRuntimeOrderWriteMode(process.env.PERSISTENCE_RUNTIME_ORDER_WRITES_ENABLED);
  return Object.freeze({
    confirmedOrderWriter: new RuntimeConfirmedOrderWriter(
      persistence.confirmedOrderPersistenceService,
      mode,
      input.whatsappTransactionalOutboxAppender,
    ),
  });
}
