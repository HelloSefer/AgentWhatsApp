import type { DatabaseTransactionExecutor, TenantContext } from "../../../infrastructure/database";
import { withTransaction } from "../../../infrastructure/database/transactions/with-transaction.service";
import type { WhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  WhatsAppConnectionDisconnectConflictError,
  WhatsAppConnectionDisconnectValidationError,
  WhatsAppConnectionPersistenceError,
} from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";
import { normalizeConnectionId } from "../domain/whatsapp-connection.validation";
import { recordWhatsAppConnectionAudit } from "./whatsapp-connection-operational-events";

export type DisconnectWhatsAppConnectionResult = Readonly<{
  disconnected: true;
  connection: Readonly<{
    connectionId: string;
    status: "DISCONNECTED";
    disconnectedAt: Date | null;
  }>;
}>;

export type TransactionRunner = <Result>(callback: (transaction: DatabaseTransactionExecutor) => Promise<Result>) => Promise<Result>;

export class WhatsAppConnectionDisconnectService {
  constructor(
    private readonly repository: WhatsAppConnectionRepository,
    private readonly transactionRunner: TransactionRunner = withTransaction,
  ) {}

  async disconnect(tenant: TenantContext, connectionId: string): Promise<DisconnectWhatsAppConnectionResult> {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    const connection = await this.repository.findByConnectionId(tenant, normalizedConnectionId);
    if (!connection) throw new WhatsAppConnectionDisconnectConflictError();
    if (connection.status === "DISCONNECTED") return responseFromConnection(connection);
    if (connection.status !== "ACTIVE") throw new WhatsAppConnectionDisconnectConflictError();

    try {
      const disconnected = await this.transactionRunner(async (executor) => {
        const current = await this.repository.findByConnectionId(tenant, normalizedConnectionId, { executor });
        if (!current) throw new WhatsAppConnectionDisconnectConflictError();
        if (current.status === "DISCONNECTED") return current;
        if (current.status !== "ACTIVE") throw new WhatsAppConnectionDisconnectConflictError();

        const updated = await this.repository.disconnectActiveConnection(tenant, normalizedConnectionId, { executor });
        if (!updated) throw new WhatsAppConnectionDisconnectConflictError();
        return updated;
      });
      recordWhatsAppConnectionAudit("whatsapp_connection.disconnected", {
        sellerId: tenant.sellerId,
        connectionId: disconnected.connectionId,
        status: disconnected.status,
      });
      return responseFromConnection(disconnected);
    } catch (error) {
      if (error instanceof WhatsAppConnectionDisconnectConflictError || error instanceof WhatsAppConnectionPersistenceError) throw error;
      throw new WhatsAppConnectionPersistenceError(error);
    }
  }

  private normalizeConnectionId(connectionId: string): string {
    try {
      return normalizeConnectionId(connectionId);
    } catch {
      throw new WhatsAppConnectionDisconnectValidationError();
    }
  }
}

function responseFromConnection(connection: WhatsAppConnection): DisconnectWhatsAppConnectionResult {
  return {
    disconnected: true,
    connection: {
      connectionId: connection.connectionId,
      status: "DISCONNECTED",
      disconnectedAt: connection.disconnectedAt ?? null,
    },
  };
}
