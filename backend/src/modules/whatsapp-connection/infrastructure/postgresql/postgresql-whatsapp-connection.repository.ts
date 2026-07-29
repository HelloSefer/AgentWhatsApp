import { randomUUID } from "node:crypto";
import {
  DatabaseQueryError,
  executeDatabaseQuery,
  type DatabaseQueryExecutor,
  type TenantContext,
} from "../../../../infrastructure/database";
import type {
  CreateWhatsAppConnectionCandidateInput,
  CreateManualWhatsAppConnectionDraftInput,
  ReplaceManualWhatsAppConnectionCredentialsInput,
  VerifiedWhatsAppConnectionMetadataInput,
  WhatsAppConnectionFinalizationProgressInput,
  WhatsAppConnectionRepository,
  WhatsAppConnectionRepositoryOptions,
} from "../../contracts/whatsapp-connection.repository";
import type {
  PersistWhatsAppConnectionCredentialInput,
  PersistManualWhatsAppConnectionCredentialInput,
  ManualWhatsAppConnectionCredentialStorage,
  PersistWhatsAppConnectionRegistrationPinInput,
  WhatsAppConnectionCredentialStorage,
  WhatsAppConnectionRegistrationPinStorage,
} from "../../domain/whatsapp-connection-credentials.types";
import {
  WhatsAppConnectionActiveAlreadyExistsError,
  WhatsAppConnectionCompletionConflictError,
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
  normalizeMetaAppId,
  normalizeMetaId,
  normalizeOptionalWhatsAppConnectionText,
  validateWhatsAppConnectionStatus,
} from "../../domain/whatsapp-connection.validation";
import { mapWhatsAppConnection, type WhatsAppConnectionRow } from "./whatsapp-connection-row.mapper";

const CONNECTION_COLUMNS = "connection_id, seller_id, provider, connection_method, status, meta_app_id, public_webhook_id, meta_business_id, waba_id, phone_number_id, display_phone_number, verified_name, connected_at, last_verified_at, phone_registration_completed_at, waba_subscription_completed_at, finalization_last_error_code, finalization_last_error_at, disconnected_at, replaced_connection_id, created_at, updated_at";
const CREDENTIAL_COLUMNS = "connection_id, seller_id, encrypted_access_token, token_key_version, token_fingerprint, token_expires_at";
const REGISTRATION_PIN_COLUMNS = "connection_id, seller_id, encrypted_registration_pin, registration_pin_key_version, registration_pin_fingerprint";
const MANUAL_CREDENTIAL_COLUMNS = "connection_id, seller_id, encrypted_meta_app_secret, meta_app_secret_key_version, encrypted_system_user_access_token, system_user_access_token_key_version, encrypted_webhook_verify_token, webhook_verify_token_key_version";

type WhatsAppConnectionCredentialRow = Readonly<{
  connection_id: string;
  seller_id: string;
  encrypted_access_token: string;
  token_key_version: string;
  token_fingerprint: string;
  token_expires_at: Date | string | null;
}>;

type WhatsAppConnectionRegistrationPinRow = Readonly<{
  connection_id: string;
  seller_id: string;
  encrypted_registration_pin: string;
  registration_pin_key_version: string;
  registration_pin_fingerprint: string;
}>;

type ManualWhatsAppConnectionCredentialRow = Readonly<{
  connection_id: string;
  seller_id: string;
  encrypted_meta_app_secret: string;
  meta_app_secret_key_version: string;
  encrypted_system_user_access_token: string;
  system_user_access_token_key_version: string;
  encrypted_webhook_verify_token: string;
  webhook_verify_token_key_version: string;
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
    error instanceof WhatsAppConnectionCompletionConflictError ||
    error instanceof WhatsAppConnectionPhoneNumberAlreadyAssignedError
  ) throw error;

  if (databaseCode(error) === "23503") throw new WhatsAppConnectionSellerNotFoundError();
  if (databaseCode(error) === "23505") {
    const constraint = constraintName(error);
    if (constraint === "whatsapp_connections_one_active_per_seller_idx") throw new WhatsAppConnectionActiveAlreadyExistsError();
    if (constraint === "whatsapp_connections_phone_number_id_unique_idx" || constraint === "whatsapp_connections_current_phone_number_id_unique_idx") throw new WhatsAppConnectionPhoneNumberAlreadyAssignedError();
    if (constraint === "whatsapp_connections_manual_pending_retry_idx") throw new WhatsAppConnectionCompletionConflictError();
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

function mapRegistrationPinStorage(row: WhatsAppConnectionRegistrationPinRow): WhatsAppConnectionRegistrationPinStorage {
  return {
    connectionId: row.connection_id,
    sellerId: row.seller_id,
    encryptedRegistrationPin: normalizeCredentialField(row.encrypted_registration_pin),
    registrationPinKeyVersion: normalizeCredentialField(row.registration_pin_key_version),
    registrationPinFingerprint: normalizeCredentialField(row.registration_pin_fingerprint),
  };
}

function mapManualCredentialStorage(row: ManualWhatsAppConnectionCredentialRow): ManualWhatsAppConnectionCredentialStorage {
  return {
    connectionId: row.connection_id,
    sellerId: row.seller_id,
    encryptedMetaAppSecret: normalizeCredentialField(row.encrypted_meta_app_secret),
    metaAppSecretKeyVersion: normalizeCredentialField(row.meta_app_secret_key_version),
    encryptedSystemUserAccessToken: normalizeCredentialField(row.encrypted_system_user_access_token),
    systemUserAccessTokenKeyVersion: normalizeCredentialField(row.system_user_access_token_key_version),
    encryptedWebhookVerifyToken: normalizeCredentialField(row.encrypted_webhook_verify_token),
    webhookVerifyTokenKeyVersion: normalizeCredentialField(row.webhook_verify_token_key_version),
  };
}

function normalizeFinalizationErrorCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || !/^[a-z0-9_]+$/u.test(trimmed)) throw new WhatsAppConnectionPersistenceError();
  return trimmed;
}

export class PostgreSqlWhatsAppConnectionRepository implements WhatsAppConnectionRepository {
  async createCandidate(tenant: TenantContext, input?: CreateWhatsAppConnectionCandidateInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection> {
    const connectionId = input?.connectionId ? normalizeConnectionId(input.connectionId) : randomUUID();
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          INSERT INTO whatsapp_connections (connection_id, seller_id, provider, connection_method, status)
          VALUES ($1, $2, $3, 'EMBEDDED_SIGNUP', 'PENDING')
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

  async createManualDraft(tenant: TenantContext, input: CreateManualWhatsAppConnectionDraftInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection> {
    const connectionId = randomUUID();
    const publicWebhookId = normalizeConnectionId(input.publicWebhookId);
    const metaAppId = normalizeMetaId(input.metaAppId);
    if (!metaAppId) throw new WhatsAppConnectionPersistenceError();
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          INSERT INTO whatsapp_connections (connection_id, seller_id, provider, connection_method, status, meta_app_id, public_webhook_id)
          VALUES ($1, $2, $3, 'CUSTOMER_OWNED_META_APP', 'PENDING', $4, $5)
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [connectionId, tenant.sellerId, WHATSAPP_CONNECTION_PROVIDER, metaAppId, publicWebhookId],
      });
      const row = result.rows[0];
      if (!row) throw new WhatsAppConnectionPersistenceError();
      return mapWhatsAppConnection(row);
    } catch (error) {
      mapWriteError(error);
    }
  }

  async findReusableManualDraft(tenant: TenantContext, metaAppId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedMetaAppId = normalizeMetaId(metaAppId);
    if (!normalizedMetaAppId) return null;
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          SELECT ${CONNECTION_COLUMNS}
          FROM whatsapp_connections
          WHERE seller_id = $1
            AND connection_method = 'CUSTOMER_OWNED_META_APP'
            AND status = 'PENDING'
            AND meta_app_id = $2
          ORDER BY created_at DESC, connection_id ASC
          LIMIT 1
        `,
        values: [tenant.sellerId, normalizedMetaAppId],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapReadError(error);
    }
  }

  async findByPublicWebhookId(publicWebhookId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedPublicWebhookId = normalizeConnectionId(publicWebhookId);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          SELECT ${CONNECTION_COLUMNS}
          FROM whatsapp_connections
          WHERE public_webhook_id = $1
            AND connection_method = 'CUSTOMER_OWNED_META_APP'
          LIMIT 1
        `,
        values: [normalizedPublicWebhookId],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapReadError(error);
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
        text: `
          SELECT ${CONNECTION_COLUMNS}
          FROM whatsapp_connections
          WHERE seller_id = $1
            AND phone_number_id = $2
            AND status IN ('PENDING', 'VERIFYING', 'ACTIVE', 'REPLACEMENT_PENDING')
          ORDER BY created_at DESC
          LIMIT 1
        `,
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
        text: `
          SELECT ${CONNECTION_COLUMNS}
          FROM whatsapp_connections
          WHERE phone_number_id = $1
            AND status IN ('PENDING', 'VERIFYING', 'ACTIVE', 'REPLACEMENT_PENDING')
          ORDER BY created_at DESC
          LIMIT 1
        `,
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

  async markReplacementPending(tenant: TenantContext, connectionId: string, replacedConnectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const normalizedReplacedConnectionId = normalizeConnectionId(replacedConnectionId);
    if (normalizedConnectionId === normalizedReplacedConnectionId) return null;
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          UPDATE whatsapp_connections candidate
          SET
            status = 'REPLACEMENT_PENDING',
            replaced_connection_id = $3,
            connected_at = NULL,
            disconnected_at = NULL,
            updated_at = NOW()
          WHERE candidate.seller_id = $1
            AND candidate.connection_id = $2
            AND candidate.status IN ('PENDING', 'VERIFYING', 'REPLACEMENT_PENDING')
            AND EXISTS (
              SELECT 1
              FROM whatsapp_connections active
              WHERE active.seller_id = $1
                AND active.connection_id = $3
                AND active.status = 'ACTIVE'
            )
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [tenant.sellerId, normalizedConnectionId, normalizedReplacedConnectionId],
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

  async persistManualCredentials(tenant: TenantContext, connectionId: string, credential: PersistManualWhatsAppConnectionCredentialInput, options?: WhatsAppConnectionRepositoryOptions): Promise<ManualWhatsAppConnectionCredentialStorage | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const encryptedMetaAppSecret = normalizeCredentialField(credential.encryptedMetaAppSecret);
    const metaAppSecretKeyVersion = normalizeCredentialField(credential.metaAppSecretKeyVersion);
    const encryptedSystemUserAccessToken = normalizeCredentialField(credential.encryptedSystemUserAccessToken);
    const systemUserAccessTokenKeyVersion = normalizeCredentialField(credential.systemUserAccessTokenKeyVersion);
    const encryptedWebhookVerifyToken = normalizeCredentialField(credential.encryptedWebhookVerifyToken);
    const webhookVerifyTokenKeyVersion = normalizeCredentialField(credential.webhookVerifyTokenKeyVersion);
    try {
      const result = await executor(options).execute<ManualWhatsAppConnectionCredentialRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            encrypted_meta_app_secret = $3,
            meta_app_secret_key_version = $4,
            encrypted_system_user_access_token = $5,
            system_user_access_token_key_version = $6,
            encrypted_webhook_verify_token = $7,
            webhook_verify_token_key_version = $8,
            updated_at = NOW()
          WHERE seller_id = $1
            AND connection_id = $2
            AND connection_method = 'CUSTOMER_OWNED_META_APP'
            AND status = 'PENDING'
          RETURNING ${MANUAL_CREDENTIAL_COLUMNS}
        `,
        values: [tenant.sellerId, normalizedConnectionId, encryptedMetaAppSecret, metaAppSecretKeyVersion, encryptedSystemUserAccessToken, systemUserAccessTokenKeyVersion, encryptedWebhookVerifyToken, webhookVerifyTokenKeyVersion],
      });
      return result.rows[0] ? mapManualCredentialStorage(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async replaceManualCredentialsAndResetState(tenant: TenantContext, connectionId: string, credential: ReplaceManualWhatsAppConnectionCredentialsInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const metaAppId = normalizeMetaAppId(credential.metaAppId);
    const encryptedMetaAppSecret = normalizeCredentialField(credential.encryptedMetaAppSecret);
    const metaAppSecretKeyVersion = normalizeCredentialField(credential.metaAppSecretKeyVersion);
    const encryptedSystemUserAccessToken = normalizeCredentialField(credential.encryptedSystemUserAccessToken);
    const systemUserAccessTokenKeyVersion = normalizeCredentialField(credential.systemUserAccessTokenKeyVersion);
    const encryptedWebhookVerifyToken = normalizeCredentialField(credential.encryptedWebhookVerifyToken);
    const webhookVerifyTokenKeyVersion = normalizeCredentialField(credential.webhookVerifyTokenKeyVersion);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            meta_app_id = $3,
            encrypted_meta_app_secret = $4,
            meta_app_secret_key_version = $5,
            encrypted_system_user_access_token = $6,
            system_user_access_token_key_version = $7,
            encrypted_webhook_verify_token = $8,
            webhook_verify_token_key_version = $9,
            encrypted_access_token = NULL,
            token_key_version = NULL,
            token_fingerprint = NULL,
            token_expires_at = NULL,
            meta_business_id = NULL,
            waba_id = NULL,
            phone_number_id = NULL,
            display_phone_number = NULL,
            verified_name = NULL,
            last_verified_at = NULL,
            encrypted_registration_pin = NULL,
            registration_pin_key_version = NULL,
            registration_pin_fingerprint = NULL,
            phone_registration_completed_at = NULL,
            waba_subscription_completed_at = NULL,
            finalization_last_error_code = NULL,
            finalization_last_error_at = NULL,
            connected_at = NULL,
            disconnected_at = NULL,
            status = 'PENDING',
            updated_at = NOW()
          WHERE seller_id = $1
            AND connection_id = $2
            AND connection_method = 'CUSTOMER_OWNED_META_APP'
            AND status IN ('PENDING', 'VERIFYING', 'REPLACEMENT_PENDING', 'ERROR')
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [
          tenant.sellerId,
          normalizedConnectionId,
          metaAppId,
          encryptedMetaAppSecret,
          metaAppSecretKeyVersion,
          encryptedSystemUserAccessToken,
          systemUserAccessTokenKeyVersion,
          encryptedWebhookVerifyToken,
          webhookVerifyTokenKeyVersion,
        ],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async findManualCredentialStorage(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<ManualWhatsAppConnectionCredentialStorage | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    try {
      const result = await executor(options).execute<ManualWhatsAppConnectionCredentialRow>({
        text: `
          SELECT ${MANUAL_CREDENTIAL_COLUMNS}
          FROM whatsapp_connections
          WHERE seller_id = $1
            AND connection_id = $2
            AND encrypted_meta_app_secret IS NOT NULL
            AND meta_app_secret_key_version IS NOT NULL
            AND encrypted_system_user_access_token IS NOT NULL
            AND system_user_access_token_key_version IS NOT NULL
            AND encrypted_webhook_verify_token IS NOT NULL
            AND webhook_verify_token_key_version IS NOT NULL
          LIMIT 1
        `,
        values: [tenant.sellerId, normalizedConnectionId],
      });
      return result.rows[0] ? mapManualCredentialStorage(result.rows[0]) : null;
    } catch (error) {
      mapReadError(error);
    }
  }

  async persistRegistrationPinCredential(tenant: TenantContext, connectionId: string, credential: PersistWhatsAppConnectionRegistrationPinInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const encryptedRegistrationPin = normalizeCredentialField(credential.encryptedRegistrationPin);
    const registrationPinKeyVersion = normalizeCredentialField(credential.registrationPinKeyVersion);
    const registrationPinFingerprint = normalizeCredentialField(credential.registrationPinFingerprint);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRegistrationPinRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            encrypted_registration_pin = $3,
            registration_pin_key_version = $4,
            registration_pin_fingerprint = $5,
            updated_at = NOW()
          WHERE seller_id = $1 AND connection_id = $2
          RETURNING ${REGISTRATION_PIN_COLUMNS}
        `,
        values: [tenant.sellerId, normalizedConnectionId, encryptedRegistrationPin, registrationPinKeyVersion, registrationPinFingerprint],
      });
      return result.rows[0] ? mapRegistrationPinStorage(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async findRegistrationPinStorage(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnectionRegistrationPinStorage | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRegistrationPinRow>({
        text: `
          SELECT ${REGISTRATION_PIN_COLUMNS}
          FROM whatsapp_connections
          WHERE seller_id = $1
            AND connection_id = $2
            AND encrypted_registration_pin IS NOT NULL
            AND registration_pin_key_version IS NOT NULL
            AND registration_pin_fingerprint IS NOT NULL
          LIMIT 1
        `,
        values: [tenant.sellerId, normalizedConnectionId],
      });
      return result.rows[0] ? mapRegistrationPinStorage(result.rows[0]) : null;
    } catch (error) {
      mapReadError(error);
    }
  }

  async persistFinalizationProgress(tenant: TenantContext, connectionId: string, input: WhatsAppConnectionFinalizationProgressInput, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    const errorCode = normalizeFinalizationErrorCode(input.finalizationLastErrorCode);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            phone_registration_completed_at = COALESCE(phone_registration_completed_at, $3),
            waba_subscription_completed_at = COALESCE(waba_subscription_completed_at, $4),
            finalization_last_error_code = CASE
              WHEN $5::boolean THEN NULL
              WHEN $6::varchar IS NOT NULL THEN $6
              ELSE finalization_last_error_code
            END,
            finalization_last_error_at = CASE
              WHEN $5::boolean THEN NULL
              WHEN $6::varchar IS NOT NULL THEN NOW()
              ELSE finalization_last_error_at
            END,
            updated_at = NOW()
          WHERE seller_id = $1 AND connection_id = $2
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [
          tenant.sellerId,
          normalizedConnectionId,
          input.phoneRegistrationCompletedAt ?? null,
          input.wabaSubscriptionCompletedAt ?? null,
          input.clearFinalizationLastError === true,
          errorCode,
        ],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async activateConnection(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            status = 'ACTIVE',
            connected_at = COALESCE(connected_at, NOW()),
            last_verified_at = NOW(),
            finalization_last_error_code = NULL,
            finalization_last_error_at = NULL,
            updated_at = NOW()
          WHERE seller_id = $1
            AND connection_id = $2
            AND status = 'VERIFYING'
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [tenant.sellerId, normalizedConnectionId],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async replaceActiveConnection(tenant: TenantContext, activeConnectionId: string, replacementConnectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedActiveConnectionId = normalizeConnectionId(activeConnectionId);
    const normalizedReplacementConnectionId = normalizeConnectionId(replacementConnectionId);
    if (normalizedActiveConnectionId === normalizedReplacementConnectionId) return null;
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          WITH old_connection AS (
            UPDATE whatsapp_connections
            SET
              status = 'DISCONNECTED',
              disconnected_at = COALESCE(disconnected_at, NOW()),
              updated_at = NOW()
            WHERE seller_id = $1
              AND connection_id = $2
              AND status = 'ACTIVE'
            RETURNING connection_id
          ),
          new_connection AS (
            UPDATE whatsapp_connections
            SET
              status = 'ACTIVE',
              connected_at = NOW(),
              last_verified_at = NOW(),
              finalization_last_error_code = NULL,
              finalization_last_error_at = NULL,
              disconnected_at = NULL,
              updated_at = NOW()
            WHERE seller_id = $1
              AND connection_id = $3
              AND status = 'REPLACEMENT_PENDING'
              AND replaced_connection_id = $2
              AND EXISTS (SELECT 1 FROM old_connection)
            RETURNING ${CONNECTION_COLUMNS}
          )
          SELECT ${CONNECTION_COLUMNS} FROM new_connection
        `,
        values: [tenant.sellerId, normalizedActiveConnectionId, normalizedReplacementConnectionId],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }

  async disconnectActiveConnection(tenant: TenantContext, connectionId: string, options?: WhatsAppConnectionRepositoryOptions): Promise<WhatsAppConnection | null> {
    const normalizedConnectionId = normalizeConnectionId(connectionId);
    try {
      const result = await executor(options).execute<WhatsAppConnectionRow>({
        text: `
          UPDATE whatsapp_connections
          SET
            status = 'DISCONNECTED',
            disconnected_at = COALESCE(disconnected_at, NOW()),
            updated_at = NOW()
          WHERE seller_id = $1
            AND connection_id = $2
            AND status = 'ACTIVE'
          RETURNING ${CONNECTION_COLUMNS}
        `,
        values: [tenant.sellerId, normalizedConnectionId],
      });
      return result.rows[0] ? mapWhatsAppConnection(result.rows[0]) : null;
    } catch (error) {
      mapWriteError(error);
    }
  }
}

export const postgreSqlWhatsAppConnectionRepository = new PostgreSqlWhatsAppConnectionRepository();
