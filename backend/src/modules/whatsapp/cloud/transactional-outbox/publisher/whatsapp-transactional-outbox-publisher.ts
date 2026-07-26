import crypto from "node:crypto";
import type { WhatsAppOutboundGroupDispatcher } from "../../outbound-queue/whatsapp-outbound-job.types";
import { WhatsAppTransactionalOutboxRepository } from "../infrastructure/whatsapp-transactional-outbox.repository";

export const WHATSAPP_TRANSACTIONAL_OUTBOX_POLL_INTERVAL_MS = 500;
export const WHATSAPP_TRANSACTIONAL_OUTBOX_BATCH_SIZE = 10;
export const WHATSAPP_TRANSACTIONAL_OUTBOX_CLAIM_LEASE_MS = 30_000;

export class WhatsAppTransactionalOutboxPublisher {
  private readonly ownerId = `whatsapp-outbox-${process.pid}-${crypto.randomUUID()}`;
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly repository: WhatsAppTransactionalOutboxRepository,
    private readonly dispatcher: WhatsAppOutboundGroupDispatcher,
    private readonly constants: Readonly<{
      pollIntervalMs?: number;
      batchSize?: number;
      claimLeaseMs?: number;
    }> = {},
  ) {}

  start(): void {
    if (this.timer || this.stopping) return;
    this.timer = setInterval(() => void this.poll(), this.constants.pollIntervalMs || WHATSAPP_TRANSACTIONAL_OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref?.();
    void this.poll();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.active;
  }

  async poll(): Promise<void> {
    if (this.stopping || this.active) return;
    this.active = this.publishClaimedBatch().finally(() => {
      this.active = undefined;
    });
    await this.active;
  }

  private async publishClaimedBatch(): Promise<void> {
    const rows = await this.repository.claimPending({
      ownerId: this.ownerId,
      batchSize: this.constants.batchSize || WHATSAPP_TRANSACTIONAL_OUTBOX_BATCH_SIZE,
      leaseMs: this.constants.claimLeaseMs || WHATSAPP_TRANSACTIONAL_OUTBOX_CLAIM_LEASE_MS,
    });
    for (const row of rows) {
      try {
        const result = await this.dispatcher.dispatchOutboundGroup(row.payload);
        if (result.accepted === true) {
          await this.repository.markPublished({ outboxId: row.outboxId, ownerId: this.ownerId });
        } else {
          await this.repository.recordPublicationFailure({ outboxId: row.outboxId, ownerId: this.ownerId, error: new Error("outbound_enqueue_not_accepted") });
        }
      } catch (error) {
        await this.repository.recordPublicationFailure({ outboxId: row.outboxId, ownerId: this.ownerId, error });
      }
    }
  }
}
