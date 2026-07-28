import { randomUUID } from "node:crypto";
import {
  DatabaseQueryError,
  executeDatabaseQuery,
  type DatabaseQueryExecutor,
  type TenantContext,
} from "../../../../infrastructure/database";
import type {
  CreateWhatsAppConnectionCandidateInput,
  VerifiedWhatsAppConnectionMetadataInput,
  WhatsAppConnectionRepository,
  WhatsAppConnectionRepositoryOptions,
} from "../../contracts/whatsapp-connection.repository";
import type { PersistWhatsAppConnectionCredentialInput, WhatsAppConnectionCredentialStorage } from "../../domain/whatsapp-connection-credentials.types";
import {
  WhatsAppConnectionActiveAlreadyExistsError,
  WhatsAppConnectionPersistenceError,
  WhatsAppConnectionPhoneNumberAlreadyAssignedError,
  WhatsAppConnectionSellerNotFoundError,
} from "../../domain/whatsapp-connection.errors";
import {
  WHATSAPP_CONNECTION_PROVIDER,
  type ActiveWhatsAppConnectionResolution,
  type WhatsAppConnection,
  type WhatsAppConnectionStatus,
} from "../../domain/whatsapp-connection.types";
import {
  normalizeConnectionId,
  normalizeDisplayPhoneNumber,
  normalizeMetaId,
  normalizeOptionalWhatsAppConnectionText,
  validateWhatsAppConnectionStatus,
} from "../../domain/whatsapp-connection.validation";
import { mapWhatsAppConnection, type WhatsAppConnectionRow } from "./whatsapp-connection-row.mapper";

const CONNECTION_COLUMNS = "connection_id, seller_id, provider, status, meta_business_id, waba_id, phone_number_id, display_phone_number, verified_name, connected_at, last_verified_at, disconnected_at, created_at, updated_at";
const CREDENTIAL_COLUMNS = "connection_id, seller_id, encrypted_access_token, token_key_version, token_fingerprint, token_expires_at";

type WhatsAppConnectionCredentialRow = Readonly<{
  connection_id: string;
  seller_id: string;
  encrypted_access_token: string;
  token_key_version: string;
  token_fingerprint: string;
  token_expires_at: Date | string | null;
}>;

function executor(options?: WhatsAppConnectionRepositoryOptions): DatabaseQueryExecutor {
  return options?.executor ?? { execute: executeDatabaseQuery };
}

function databaseCode(error: unknown): string | undefined {
  return error instanceof DatabaseQueryError &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    typeof error.cause.code === "string"
    ? error.cause.code
    : undefined;
}

function constraintName(error: unknown): string | undefined {
  return error instanceof DatabaseQueryError &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "constraint" in error.cause &&
    typeof error.cause.constraint === "string"
    ? error.cause.constraint
    : undefined;
}

function mapWriteError(error: unknown): never {
  if (
    error instanceof WhatsAppConnectionPersistenceError ||
    error instanceof WhatsAppConnectionSellerNotFoundError ||
    error instanceof WhatsAppConnectionActiveAlreadyExistsError ||
    error instanceof WhatsAppConnectionPhoneNumberAlreadyAssignedError
  ) throw error;

  if (databaseCode(error) === "23503") throw new WhatsAppConnectionSellerNotFoundError();
  if (databaseCode(error) === "23505") {
    const constraint = constraintName(error);
    if (constraint === "whatsapp_connections_one_active_per_seller_idx") throw new WhatsAppConnectionActiveAlreadyExistsError();
    if (constraint === "whatsapp_connections_phone_number_id_unique_idx") throw new WhatsAppConnectionPhoneNumberAlreadyAssignedError();
  }
  throw new WhatsAppConnectionPersistenceError(error);
}

function mapReadError(error: unknown): never {
  if (error instanceof WhatsAppConnectionPersistenceError) throw error;
  throw new WhatsAppConnectionPersistenceError(error);
}

function normalizeCredentialField(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new WhatsAppConnectionPersistenceError();
  return trimmed;
}

function mapCredentialStorage(row: WhatsAppConnectionCredentialRow): WhatsAppConnectionCredentialStorage {
  const tokenExpiresAt = row.token_expires_at === null ? undefined : new Date(row.token_expires_at);
  if (tokenExpiresAt && Number.isNaN(tokenExpiresAt.getTime())) throw new WhatsAppConnectionPersistenceError();
  return {
    connectionId: row.connection_id,
    sellerId: row.seller_id,
    encryptedAccessToken: row.encrypted_access_token,
    tokenKeyVersion: row.token_key_version,
    tokenFingerprint: row.token_fingerprint,
    tokenExpiresAt,
  };
}

export class PostgreSqlWhatsAppConnectionRepository implements WhatsAppConnectionRepository {
  async createCandidate(tenant: TenantContext, input?: CreateWhatsAppConnectionCandidateInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection> {
    const connectionId = input?.connectionId ? normalizeConnectionId(input.connectionId) : randomUUID();
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          INSERT INTO whatsapp_connections (connection_id, seller_id, provider, status)
          VALUES ($1, $2, $3, 'PENDING')
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [connectionId, tenant.sellerId, WHATSAPP_CONNECTION_PROVIDER],
      });
      const row = result.rows[0];
      if (!row) throw new WhatsAppConnectionPersistenceError();
      return mapWhatsAppConnection(row);
    } catch (error) {
      mapWriteError(error);
    }
  }

  async findByConnectionId(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `SELECT ${CONNECTION_COLUMNS} FROM whatsapp_connections WHERE seller_id = $1 AND connection_id = $2 LIMIT 1`,
        values: [tenant.sellerId, normalizedConnectionId],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapReadError(error);
    }
  }

  async findAllForSeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<readonly WhatsAppConnection[]> {
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `SELECT ${CONNECTION_COLUMNS} FROM whatsapp_connections WHERE seller_id = $1 ORDER BY created_at DESC, connection_id ASC`,
        values: [tenant.sellerId],
      });
      return result.rows.map(mapWhatsAppConnection);
    } catch (error) {
      mapReadError(error);
    }
  }

  async findCurrentForSeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<readonly WhatsAppConnection[]> {
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `SELECT ${CONNECTION_COLUMNS} FROM whatsapp_connections WHERE seller_id = $1 AND status IN ('PENDING', 'VERIFYING', 'ACTIVE', 'REPLACEMENT_PENDING', 'ERROR') ORDER BY created_at DESC, connection_id ASC`,
        values: [tenant.sellerId],
      });
      return result.rows.map(mapWhatsAppConnection);
    } catch (error) {
      mapReadError(error);
    }
  }

  async findActiveBySeller(tenant: TenantContext, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `SELECT ${CONNECTION_COLUMNS} FROM whatsapp_connections WHERE seller_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        values: [tenant.sellerId],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapReadError(error);
    }
  }

  async findByPhoneNumberIdForSeller(tenant: TenantContext, phoneNumberId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedPhoneNumberId = normalizeMetaId(phoneNumberId);
    if (!normalizedPhoneNumberId) return null;
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `SELECT ${CONNECTION_COLUMNS} FROM whatsapp_connections WHERE seller_id = $1 AND phone_number_id = $2 ORDER BY created_at DESC LIMIT 1`,
        values: [tenant.sellerId, normalizedPhoneNumberId],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapReadError(error);
    }
  }

  async resolveByPhoneNumberId(phoneNumberId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<ActiveWhatsAppConnectionResolution | null> {
    const normalizedPhoneNumberId = normalizeMetaId(phoneNumberId);
    if (!normalizedPhoneNumberId) return null;
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `SELECT ${CONNECTION_COLUMNS} FROM whatsapp_connections WHERE phone_number_id = $1 LIMIT 1`,
        values: [normalizedPhoneNumberId],
      });
      const row = result.rows[0];
      if (!row) return null;
      const connection = mapWhatsAppConnection(row);
      return { sellerId: connection.sellerId, connection };
    } catch (error) {
      mapReadError(error);
    }
  }

  async resolveActiveByPhoneNumberId(phoneNumberId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<ActiveWhatsAppConnectionResolution | null> {
    const normalizedPhoneNumberId = normalizeMetaId(phoneNumberId);
    if (!normalizedPhoneNumberId) return null;
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `SELECT ${CONNECTION_COLUMNS} FROM whatsapp_connections WHERE phone_number_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        values: [normalizedPhoneNumberId],
      });
      const row = result.rows[0];
      if (!row) return null;
      const connection = mapWhatsAppConnection(row);
      return { sellerId: connection.sellerId, connection };
    } catch (error) {
      mapReadError(error);
    }
  }

  async updateLifecycleStatus(tenant: TenantContext, connectionId: string, status: WhatsAppConnectionStatus, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const normalizedStatus = validateWhatsAppConnectionStatus(status);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            status = $3,
            connected_at = CASE WHEN $3::varchar = 'ACTIVE' AND connected_at IS NULL THEN NOW() ELSE connected_at END,
            disconnected_at = CASE WHEN $3::varchar IN ('DISCONNECTED', 'REVOKED') AND disconnected_at IS NULL THEN NOW() ELSE disconnected_at END,
            updated_at = NOW()
          WHERE seller_id = $1 AND connection_id = $2
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [tenant.sellerId, normalizedConnectionId, normalizedStatus],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async persistVerifiedMetadata(tenant: TenantContext, connectionId: string, metadata: VerifiedWhatsAppConnectionMetadataInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const metaBusinessId = normalizeMetaId(metadata.metaBusinessId);
    const wabaId = normalizeMetaId(metadata.wabaId);
    const phoneNumberId = normalizeMetaId(metadata.phoneNumberId);
    const displayPhoneNumber = normalizeDisplayPhoneNumber(metadata.displayPhoneNumber);
    const verifiedName = normalizeOptionalWhatsAppConnectionText(metadata.verifiedName, 512);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            meta_business_id = $3,
            waba_id = $4,
            phone_number_id = $5,
            display_phone_number = $6,
            verified_name = $7,
            last_verified_at = NOW(),
            updated_at = NOW()
          WHERE seller_id = $1 AND connection_id = $2
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [tenant.sellerId, normalizedConnectionId, metaBusinessId ?? null, wabaId ?? null, phoneNumberId ?? null, displayPhoneNumber ?? null, verifiedName ?? null],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async persistAccessTokenCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionCredentialInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionCredentialStorage | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const encryptedAccessToken = normalizeCredentialField(credential.encryptedAccessToken);
    const tokenKeyVersion = normalizeCredentialField(credential.tokenKeyVersion);
    const tokenFingerprint = normalizeCredentialField(credential.tokenFingerprint);
    try {
      const result = await executor(options).execute<WhatsAppConnectionCredentialRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            encrypted_access_token = $3,
            token_key_version = $4,
            token_fingerprint = $5,
            token_expires_at = $6,
            updated_at = NOW()
          WHERE seller_id = $1 AND connection_id = $2
          RETURNING ${CREDENTIAL_COLUMNS}
        `,
        values: [tenant.sellerId, normalizedConnectionId, encryptedAccessToken, tokenKeyVersion, tokenFingerprint, credential.tokenExpiresAt ?? null],
      });
      return result.rows[0] ? mapCredentialStorage(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async findCredentialStorage(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionCredentialStorage | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    try {
      const result = await executor(options).execute<WhatsAppConnectionCredentialRow>({
        text: `
          SELECT ${CREDENTIAL_COLUMNS}
          FROM whatsapp_connections
          WHERE seller_id = $1
            AND connection_id = $2
            AND encrypted_access_token IS NOT NULL
            AND token_key_version IS NOT NULL
            AND token_fingerprint IS NOT NULL
          LIMIT 1
        `,
        values: [tenant.sellerId, normalizedConnectionId],
      });
      return result.rows[0] ? mapCredentialStorage(result.rows[0]) : null;
    } catch (error) {
      mapReadError(error);
    }
  }
}

export const postgreSqlWhatsAppConnectionRepository = new PostgreSqlWhatsAppConnectionRepository();
