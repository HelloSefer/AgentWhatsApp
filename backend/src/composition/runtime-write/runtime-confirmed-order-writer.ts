import {
  ConfirmedOrderValidationError,
  OrderAlreadyExistsError,
  OrderIdempotencyConflictError,
  OrderPersistenceError,
  OrderSellerNotFoundError,
  type ConfirmedOrderPersistenceService,
} from "../../modules/agent/order/persistence";
import type { ConfirmedOrderSnapshot } from "../../modules/agent/order/confirmed-order/confirmed-order-snapshot.types";
import { buildWhatsAppOutboundJobId } from "../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-job-id";
import {
  WHATSAPP_OUTBOUND_SCHEMA_VERSION,
  type WhatsAppOutboundResponseGroup,
} from "../../modules/whatsapp/cloud/outbound-queue/whatsapp-outbound-job.types";
import type { WhatsAppTransactionalOutboxAppender } from "../../modules/whatsapp/cloud/transactional-outbox";
import {
  createTenantContext,
  DatabaseConfigurationError,
  DatabaseConnectionError,
  DatabaseQueryError,
  InvalidTenantContextError,
} from "../../infrastructure/database";
import type { RuntimeOrderWriteMode } from "./runtime-order-write-mode";
import type {
  RuntimeConfirmedOrderWriteResult,
  RuntimeOrderWriteFailureCategory,
} from "./runtime-order-write-result.types";

function failureCategory(error: unknown): RuntimeOrderWriteFailureCategory {
  if (error instanceof InvalidTenantContextError) return "tenant_invalid";
  if (error instanceof ConfirmedOrderValidationError) return "persistence_failed";
  if (error instanceof OrderSellerNotFoundError) return "seller_missing";
  if (error instanceof OrderIdempotencyConflictError) return "idempotency_conflict";
  if (error instanceof OrderAlreadyExistsError) return "order_already_exists";
  if (error instanceof DatabaseConfigurationError || error instanceof DatabaseConnectionError || error instanceof DatabaseQueryError) return "database_unavailable";
  if (error instanceof OrderPersistenceError) return "persistence_failed";
  return "persistence_failed";
}

/** Coordinates the feature-gated runtime write without exposing database details to order runtime. */
export class RuntimeConfirmedOrderWriter {
  constructor(
    private readonly confirmedOrderPersistenceService: ConfirmedOrderPersistenceService,
    private readonly mode: RuntimeOrderWriteMode,
    private readonly whatsappTransactionalOutboxAppender?: WhatsAppTransactionalOutboxAppender,
  ) {}

  async persist(input: Readonly<{
    sellerId: string;
    snapshot: ConfirmedOrderSnapshot;
    confirmationIdempotencyKey: string;
    durableReceiptOutbox?: Readonly<{
      conversationKey: string;
      customerPhone: string;
      phoneNumberId: string;
    }>;
  }>): Promise<RuntimeConfirmedOrderWriteResult> {
    if (this.mode === "disabled") return { status: "skipped", reason: "disabled" };

    try {
      const tenant = createTenantContext(input.sellerId);
      if (input.snapshot.sellerId !== tenant.sellerId || !Object.isFrozen(input.snapshot)) {
        return { status: "failed", category: "tenant_invalid" };
      }
      const group = input.durableReceiptOutbox && this.whatsappTransactionalOutboxAppender
        ? buildConfirmedOrderReceiptGroup({
          sellerId: tenant.sellerId,
          snapshot: input.snapshot,
          conversationKey: input.durableReceiptOutbox.conversationKey,
          customerPhone: input.durableReceiptOutbox.customerPhone,
          phoneNumberId: input.durableReceiptOutbox.phoneNumberId,
        })
        : undefined;
      const order = await this.confirmedOrderPersistenceService.persistConfirmedOrder(tenant, {
        snapshot: input.snapshot,
        confirmationIdempotencyKey: input.confirmationIdempotencyKey,
        transactionalAppend: group
          ? (transaction) => this.whatsappTransactionalOutboxAppender!.appendWithinTransaction(transaction, {
            group,
            role: "confirmed_order_receipt",
          })
          : undefined,
      });
      return { status: "persisted", order, ...(group ? { durableReceiptOutboxCommitted: true } : {}) };
    } catch (error) {
      return { status: "failed", category: failureCategory(error) };
    }
  }
}

function buildConfirmedOrderReceiptGroup(input: Readonly<{
  sellerId: string;
  snapshot: ConfirmedOrderSnapshot;
  conversationKey: string;
  customerPhone: string;
  phoneNumberId: string;
}>): WhatsAppOutboundResponseGroup {
  const group: WhatsAppOutboundResponseGroup = {
    schemaVersion: WHATSAPP_OUTBOUND_SCHEMA_VERSION,
    sellerId: input.sellerId,
    conversationKey: input.conversationKey,
    recipient: { waId: input.customerPhone },
    sender: { phoneNumberId: input.phoneNumberId },
    source: { type: "confirmed_order_receipt", id: input.snapshot.id },
    responseGroupId: `confirmed_order_receipt.${input.snapshot.id}.confirmed_order_receipt`,
    responseGroupRole: "confirmed_order_receipt",
    createdAt: input.snapshot.confirmedAt,
    commands: [
      {
        type: "confirmed_order_receipt",
        to: input.customerPhone,
        phoneNumberId: input.phoneNumberId,
        confirmedOrderId: input.snapshot.id,
      },
    ],
  };
  buildWhatsAppOutboundJobId(group);
  return group;
}
