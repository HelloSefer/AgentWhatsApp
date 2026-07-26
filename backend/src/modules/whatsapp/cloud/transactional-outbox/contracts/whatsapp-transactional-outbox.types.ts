import type { DatabaseTransactionExecutor } from "../../../../../infrastructure/database";
import type { WhatsAppOutboundResponseGroup } from "../../outbound-queue/whatsapp-outbound-job.types";

export const WHATSAPP_TRANSACTIONAL_OUTBOX_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type WhatsAppTransactionalOutboxRole = "confirmed_order_receipt";

export type WhatsAppTransactionalOutboxAppendInput = Readonly<{
  group: WhatsAppOutboundResponseGroup;
  role: WhatsAppTransactionalOutboxRole;
}>;

export type WhatsAppTransactionalOutboxAppender = Readonly<{
  appendWithinTransaction: (
    transaction: DatabaseTransactionExecutor,
    input: WhatsAppTransactionalOutboxAppendInput,
  ) => Promise<void>;
}>;

export type WhatsAppTransactionalOutboxRow = Readonly<{
  outboxId: string;
  sellerId: string;
  aggregateType: string;
  aggregateId: string;
  outboundRole: WhatsAppTransactionalOutboxRole;
  schemaVersion: number;
  payload: WhatsAppOutboundResponseGroup;
  outboundJobId: string;
  claimedBy?: string;
}>;
