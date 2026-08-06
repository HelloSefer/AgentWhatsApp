import type { TenantContext } from "../../../infrastructure/database";
import type { CatalogService } from "../../catalog";
import type { CatalogProduct } from "../../catalog";
import { validateCatalogProductId } from "../../catalog/domain/catalog.validation";
import { ProductNotFoundError } from "../../catalog/domain/catalog.errors";
import type { WhatsAppConnectionRepository } from "../contracts/whatsapp-connection.repository";
import {
  WhatsAppConnectionNotFoundError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionSellerNotFoundError,
} from "../domain/whatsapp-connection.errors";
import type { WhatsAppConnection } from "../domain/whatsapp-connection.types";

export type WhatsAppConnectionProductBinding = Readonly<{
  connection: WhatsAppConnection;
  product: Pick<CatalogProduct, "productId" | "name" | "availability"> | null;
}>;

export class WhatsAppConnectionProductBindingService {
  constructor(private readonly repository: WhatsAppConnectionRepository, private readonly catalogService: CatalogService) {}

  async getBinding(tenant: TenantContext, connectionId: string): Promise<WhatsAppConnectionProductBinding> {
    const connection = await this.repository.findByConnectionId(tenant, connectionId);
    if (!connection) throw new WhatsAppConnectionNotFoundError();
    return this.bindingForConnection(tenant, connection);
  }

  async isActiveConnection(tenant: TenantContext, connectionId: string): Promise<boolean> {
    const active = await this.repository.findActiveBySeller(tenant);
    return active?.connectionId === connectionId;
  }

  async setBoundProductId(tenant: TenantContext, connectionId: string, productId: unknown | null): Promise<WhatsAppConnection> {
    const connection = await this.repository.findByConnectionId(tenant, connectionId);
    if (!connection) throw new WhatsAppConnectionNotFoundError();
    const boundProductId = productId === null ? null : validateCatalogProductId(productId);
    if (boundProductId && !await this.catalogService.getProduct(tenant, boundProductId)) throw new ProductNotFoundError();
    try {
      const updated = await this.repository.setBoundProductId?.(tenant, connectionId, boundProductId);
      if (updated) return updated;
    } catch (error) {
      if (!(error instanceof WhatsAppConnectionSellerNotFoundError)) throw error;
    }

    const remainingConnection = await this.repository.findByConnectionId(tenant, connectionId);
    if (!remainingConnection) throw new WhatsAppConnectionNotFoundError();
    if (boundProductId && !await this.catalogService.getProduct(tenant, boundProductId)) throw new ProductNotFoundError();
    throw new WhatsAppConnectionPersistenceError();
  }

  private async bindingForConnection(tenant: TenantContext, connection: WhatsAppConnection): Promise<WhatsAppConnectionProductBinding> {
    if (!connection.boundProductId) return { connection, product: null };
    const product = await this.catalogService.getProduct(tenant, connection.boundProductId);
    if (product) return {
      connection,
      product: { productId: product.productId, name: product.name, availability: product.availability },
    };

    // The composite FK normally prevents this state. Re-read once to make a
    // concurrent product deletion visible as the final unbound state.
    const refreshed = await this.repository.findByConnectionId(tenant, connection.connectionId);
    if (!refreshed) throw new WhatsAppConnectionNotFoundError();
    if (!refreshed.boundProductId) return { connection: refreshed, product: null };
    throw new ProductNotFoundError();
  }
}
