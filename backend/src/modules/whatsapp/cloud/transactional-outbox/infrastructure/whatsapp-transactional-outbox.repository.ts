import crypto from "node:crypto";
import { executeDatabaseQuery, withTransaction, type DatabaseTransactionExecutor } from "../../../../../infrastructure/database";
import { buildWhatsAppOutboundJobId } from "../../outbound-queue/whatsapp-outbound-job-id";
import { validateWhatsAppOutboundResponseGroup } from "../../outbound-queue/whatsapp-outbound-validation";
import {
  WHATSAPP_TRANSACTIONAL_OUTBOX_PAYLOAD_SCHEMA_VERSION,
  type WhatsAppTransactionalOutboxAppendInput,
  type WhatsAppTransactionalOutboxAppender,
  type WhatsAppTransactionalOutboxRow,
} from "../contracts/whatsapp-transactional-outbox.types";

const MAX_SAFE_FAILURE_MESSAGE_LENGTH = 500;

function outboxIdFor(input: Readonly<{ sellerId: string; aggregateType: string; aggregateId: string; outboundRole: string }>): string {
  const hash = crypto
    .createHash("sha256")
    .update([input.sellerId, input.aggregateType, input.aggregateId, input.outboundRole].join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return `wto_${hash}`;
}

function safeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "outbox publication failed");
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/giu, "[postgres-url]")
    .replace(/redis:\/\/\S+/giu, "[valkey-url]")
    .replace(/bearer\s+\S+/giu, "bearer [redacted]")
    .slice(0, MAX_SAFE_FAILURE_MESSAGE_LENGTH);
}

function mapRow(row: Record<string, unknown>): WhatsAppTransactionalOutboxRow {
  return {
    outboxId: String(row.outbox_id),
    sellerId: String(row.seller_id),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    outboundRole: "confirmed_order_receipt",
    schemaVersion: Number(row.schema_version),
    payload: validateWhatsAppOutboundResponseGroup(row.payload_json),
    outboundJobId: String(row.outbound_job_id),
    claimedBy: typeof row.claimed_by === "string" ? row.claimed_by : undefined,
  };
}

export class WhatsAppTransactionalOutboxRepository implements WhatsAppTransactionalOutboxAppender {
  async appendWithinTransaction(
    transaction: DatabaseTransactionExecutor,
    input: WhatsAppTransactionalOutboxAppendInput,
  ): Promise<void> {
    const group = validateWhatsAppOutboundResponseGroup(input.group);
    if (input.role !== "confirmed_order_receipt" || group.source.type !== "confirmed_order_receipt") {
      throw new Error("unsupported_whatsapp_outbox_role");
    }
    const outboundJobId = buildWhatsAppOutboundJobId(group);
    const outboxId = outboxIdFor({
      sellerId: group.sellerId,
      aggregateType: group.source.type,
      aggregateId: group.source.id,
      outboundRole: group.responseGroupRole,
    });
    await transaction.execute({
      text: `
        INSERT INTO whatsapp_transactional_outbox (
          outbox_id,
          seller_id,
          aggregate_type,
          aggregate_id,
          outbound_role,
          schema_version,
          payload_json,
          outbound_job_id,
          status,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',NOW())
        ON CONFLICT (seller_id, aggregate_type, aggregate_id, outbound_role) DO NOTHING
      `,
      values: [
        outboxId,
        group.sellerId,
        group.source.type,
        group.source.id,
        group.responseGroupRole,
        WHATSAPP_TRANSACTIONAL_OUTBOX_PAYLOAD_SCHEMA_VERSION,
        JSON.stringify(group),
        outboundJobId,
      ],
    });
  }

  claimPending(input: Readonly<{ ownerId: string; batchSize: number; leaseMs: number }>): Promise<readonly WhatsAppTransactionalOutboxRow[]> {
    return withTransaction(async (transaction) => {
      const result = await transaction.execute({
        text: `
          WITH claimable AS (
            SELECT outbox_id
            FROM whatsapp_transactional_outbox
            WHERE published_at IS NULL
              AND (claimed_by IS NULL OR claim_expires_at <= NOW())
            ORDER BY created_at ASC, outbox_id ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE whatsapp_transactional_outbox outbox
          SET
            status = 'publishing',
            claimed_by = $2,
            claimed_at = NOW(),
            claim_expires_at = NOW() + ($3::text || ' milliseconds')::interval,
            publication_attempts = publication_attempts + 1
          FROM claimable
          WHERE outbox.outbox_id = claimable.outbox_id
          RETURNING outbox.*
        `,
        values: [input.batchSize, input.ownerId, input.leaseMs],
      });
      return result.rows.map(mapRow);
    });
  }

  async markPublished(input: Readonly<{ outboxId: string; ownerId: string }>): Promise<boolean> {
    const result = await executeDatabaseQuery({
      text: `
        UPDATE whatsapp_transactional_outbox
        SET status = 'published',
            published_at = NOW(),
            claimed_by = NULL,
            claimed_at = NULL,
            claim_expires_at = NULL,
            last_failure_at = NULL,
            last_failure_code = NULL,
            last_failure_message = NULL
        WHERE outbox_id = $1
          AND claimed_by = $2
          AND published_at IS NULL
      `,
      values: [input.outboxId, input.ownerId],
    });
    return result.rowCount === 1;
  }

  async recordPublicationFailure(input: Readonly<{ outboxId: string; ownerId: string; error: unknown }>): Promise<void> {
    await executeDatabaseQuery({
      text: `
        UPDATE whatsapp_transactional_outbox
        SET status = 'pending',
            claimed_by = NULL,
            claimed_at = NULL,
            claim_expires_at = NULL,
            last_failure_at = NOW(),
            last_failure_code = $3,
            last_failure_message = $4
        WHERE outbox_id = $1
          AND claimed_by = $2
          AND published_at IS NULL
      `,
      values: [input.outboxId, input.ownerId, "OUTBOUND_QUEUE_PUBLICATION_FAILED", safeFailureMessage(input.error)],
    });
  }
}
