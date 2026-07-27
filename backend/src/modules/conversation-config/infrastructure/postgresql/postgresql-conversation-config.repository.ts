import {
  DatabaseQueryError,
  executeDatabaseQuery,
  type DatabaseQueryExecutor,
  type TenantContext,
} from "../../../../infrastructure/database";
import { CONVERSATION_CONFIG_SCHEMA_VERSION, type ConversationConfigurationOverride } from "../../../conversation-engine";
import type { ConversationConfigRepository, ConversationConfigRepositoryOptions } from "../../contracts/conversation-config.repository";
import {
  ConversationConfigCorruptedError,
  ConversationConfigPersistenceError,
  ConversationConfigProductNotFoundError,
  ConversationConfigSellerNotFoundError,
} from "../../domain/conversation-config.errors";
import type { PersistedConversationConfig } from "../../domain/persisted-conversation-config.types";
import { mapPersistedConversationConfig, type ConversationConfigRow } from "./conversation-config-row.mapper";

const CONFIG_COLUMNS = "schema_version, config_json, created_at, updated_at";

function databaseCode(error: unknown): string | undefined {
  if (!(error instanceof DatabaseQueryError) || typeof error.cause !== "object" || error.cause === null || !("code" in error.cause)) return undefined;
  return typeof error.cause.code === "string" ? error.cause.code : undefined;
}

function mapPersistenceError(error: unknown, foreignKeyError: Error): never {
  if (
    error instanceof ConversationConfigPersistenceError ||
    error instanceof ConversationConfigCorruptedError ||
    error instanceof ConversationConfigSellerNotFoundError ||
    error instanceof ConversationConfigProductNotFoundError
  ) throw error;
  if (databaseCode(error) === "23503") throw foreignKeyError;
  throw new ConversationConfigPersistenceError(error);
}

function serialize(config: ConversationConfigurationOverride): string {
  return JSON.stringify(config);
}

function executor(options?: ConversationConfigRepositoryOptions): DatabaseQueryExecutor {
  return options?.executor ?? { execute: executeDatabaseQuery };
}

export class PostgreSqlConversationConfigRepository implements ConversationConfigRepository {
  async getSellerOverride(tenant: TenantContext, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig | null> {
    try {
      const result = await executor(options).execute<ConversationConfigRow>({
        text: `SELECT ${CONFIG_COLUMNS} FROM seller_conversation_configs WHERE seller_id = $1 LIMIT 1`,
        values: [tenant.sellerId],
      });
      return result.rows[0] ? mapPersistedConversationConfig(result.rows[0]) : null;
    } catch (error) {
      if (error instanceof ConversationConfigCorruptedError) throw error;
      throw new ConversationConfigPersistenceError(error);
    }
  }

  async saveSellerOverride(tenant: TenantContext, config: ConversationConfigurationOverride, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig> {
    try {
      const result = await executor(options).execute<ConversationConfigRow>({
        text: `INSERT INTO seller_conversation_configs (seller_id, schema_version, config_json) VALUES ($1, $2, $3::jsonb) ON CONFLICT (seller_id) DO UPDATE SET schema_version = EXCLUDED.schema_version, config_json = EXCLUDED.config_json, updated_at = NOW() RETURNING ${CONFIG_COLUMNS}`,
        values: [tenant.sellerId, CONVERSATION_CONFIG_SCHEMA_VERSION, serialize(config)],
      });
      if (!result.rows[0]) throw new ConversationConfigPersistenceError();
      return mapPersistedConversationConfig(result.rows[0]);
    } catch (error) {
      return mapPersistenceError(error, new ConversationConfigSellerNotFoundError());
    }
  }

  async clearSellerOverride(tenant: TenantContext, options?: ConversationConfigRepositoryOptions): Promise<void> {
    try {
      await executor(options).execute({
        text: "DELETE FROM seller_conversation_configs WHERE seller_id = $1",
        values: [tenant.sellerId],
      });
    } catch (error) {
      throw new ConversationConfigPersistenceError(error);
    }
  }

  async getProductOverride(tenant: TenantContext, productId: string, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig | null> {
    try {
      const result = await executor(options).execute<ConversationConfigRow>({
        text: `SELECT ${CONFIG_COLUMNS} FROM product_conversation_config_overrides WHERE seller_id = $1 AND product_id = $2 LIMIT 1`,
        values: [tenant.sellerId, productId],
      });
      return result.rows[0] ? mapPersistedConversationConfig(result.rows[0]) : null;
    } catch (error) {
      if (error instanceof ConversationConfigCorruptedError) throw error;
      throw new ConversationConfigPersistenceError(error);
    }
  }

  async saveProductOverride(tenant: TenantContext, productId: string, config: ConversationConfigurationOverride, options?: ConversationConfigRepositoryOptions): Promise<PersistedConversationConfig> {
    try {
      const result = await executor(options).execute<ConversationConfigRow>({
        text: `INSERT INTO product_conversation_config_overrides (seller_id, product_id, schema_version, config_json) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (seller_id, product_id) DO UPDATE SET schema_version = EXCLUDED.schema_version, config_json = EXCLUDED.config_json, updated_at = NOW() RETURNING ${CONFIG_COLUMNS}`,
        values: [tenant.sellerId, productId, CONVERSATION_CONFIG_SCHEMA_VERSION, serialize(config)],
      });
      if (!result.rows[0]) throw new ConversationConfigPersistenceError();
      return mapPersistedConversationConfig(result.rows[0]);
    } catch (error) {
      return mapPersistenceError(error, new ConversationConfigProductNotFoundError());
    }
  }

  async clearProductOverride(tenant: TenantContext, productId: string, options?: ConversationConfigRepositoryOptions): Promise<void> {
    try {
      await executor(options).execute({
        text: "DELETE FROM product_conversation_config_overrides WHERE seller_id = $1 AND product_id = $2",
        values: [tenant.sellerId, productId],
      });
    } catch (error) {
      throw new ConversationConfigPersistenceError(error);
    }
  }
}

export const postgreSqlConversationConfigRepository = new PostgreSqlConversationConfigRepository();
