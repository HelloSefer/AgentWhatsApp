import {
  DatabaseQueryError,
  executeDatabaseQuery,
  type TenantContext,
} from "../../../../infrastructure/database";
import type { SellerRepository, CreateSellerInput } from "../../contracts/seller.repository";
import type { Seller } from "../../domain/seller";
import { SellerAlreadyExistsError, SellerPersistenceError } from "../../domain/seller.errors";

type SellerRow = Readonly<{
  seller_id: string;
  created_at: Date | string;
  updated_at: Date | string;
}>;

type ExistsRow = Readonly<{
  exists: boolean;
}>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof DatabaseQueryError &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    error.cause.code === "23505";
}

function mapSeller(row: SellerRow): Seller {
  const createdAt = new Date(row.created_at);
  const updatedAt = new Date(row.updated_at);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) {
    throw new SellerPersistenceError();
  }
  return {
    sellerId: row.seller_id,
    createdAt,
    updatedAt,
  };
}

export class PostgreSqlSellerRepository implements SellerRepository {
  async create(input: CreateSellerInput): Promise<Seller> {
    try {
      const result = await executeDatabaseQuery<SellerRow>({
        text: `
          INSERT INTO sellers (seller_id)
          VALUES ($1)
          RETURNING seller_id, created_at, updated_at
        `,
        values: [input.sellerId],
      });
      const row = result.rows[0];
      if (!row) throw new SellerPersistenceError();
      return mapSeller(row);
    } catch (error) {
      if (error instanceof SellerPersistenceError) throw error;
      if (isUniqueViolation(error)) throw new SellerAlreadyExistsError();
      throw new SellerPersistenceError(error);
    }
  }

  async findByTenantContext(tenant: TenantContext): Promise<Seller | null> {
    try {
      const result = await executeDatabaseQuery<SellerRow>({
        text: `
          SELECT seller_id, created_at, updated_at
          FROM sellers
          WHERE seller_id = $1
          LIMIT 1
        `,
        values: [tenant.sellerId],
      });
      const row = result.rows[0];
      return row ? mapSeller(row) : null;
    } catch (error) {
      if (error instanceof SellerPersistenceError) throw error;
      throw new SellerPersistenceError(error);
    }
  }

  async existsByTenantContext(tenant: TenantContext): Promise<boolean> {
    try {
      const result = await executeDatabaseQuery<ExistsRow>({
        text: "SELECT EXISTS(SELECT 1 FROM sellers WHERE seller_id = $1) AS exists",
        values: [tenant.sellerId],
      });
      return result.rows[0]?.exists === true;
    } catch (error) {
      throw new SellerPersistenceError(error);
    }
  }
}

export const postgreSqlSellerRepository = new PostgreSqlSellerRepository();
