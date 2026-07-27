import { randomBytes } from "node:crypto";
import {
  DatabaseQueryError,
  executeDatabaseQuery,
  type TenantContext,
} from "../../../../infrastructure/database";
import type {
  CreateSellerWorkspaceProfileInput,
  SellerWorkspaceProfileRepository,
} from "../../contracts/seller-workspace-profile.repository";
import {
  SellerWorkspaceProfileAlreadyExistsError,
  SellerWorkspaceProfilePersistenceError,
  SellerWorkspaceProfileSellerNotFoundError,
} from "../../domain/seller-workspace-profile.errors";
import type { SellerWorkspaceLogoMetadata, SellerWorkspaceProfile } from "../../domain/seller-workspace-profile.types";
import {
  buildSlugCandidate,
  normalizeIntendedWhatsappPhoneE164,
  normalizeLogoMetadata,
  normalizeWorkspaceDisplayName,
  normalizeWorkspaceSlugBase,
  validateWorkspaceSellerId,
} from "../../domain/seller-workspace-profile.validation";
import { mapSellerWorkspaceProfile, type SellerWorkspaceProfileRow } from "./seller-workspace-profile-row.mapper";

const PROFILE_COLUMNS = "seller_id, display_name, slug, intended_whatsapp_phone_e164, logo_object_key, logo_mime_type, onboarding_completed_at, created_at, updated_at";
const MAX_SLUG_INSERT_ATTEMPTS = 8;

type ExistsRow = Readonly<{ exists: boolean }>;

function databaseCode(error: unknown): string | undefined {
  return error instanceof DatabaseQueryError &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    typeof error.cause.code === "string"
    ? error.cause.code
    : undefined;
}

function randomSlugSuffix(): string {
  return randomBytes(4).toString("hex");
}

function mapCreateError(error: unknown): never {
  const code = databaseCode(error);
  if (code === "23503") throw new SellerWorkspaceProfileSellerNotFoundError();
  if (code === "23505") throw new SellerWorkspaceProfileAlreadyExistsError();
  if (error instanceof SellerWorkspaceProfilePersistenceError || error instanceof SellerWorkspaceProfileAlreadyExistsError || error instanceof SellerWorkspaceProfileSellerNotFoundError) throw error;
  throw new SellerWorkspaceProfilePersistenceError(error);
}

function mapPersistenceError(error: unknown): never {
  if (error instanceof SellerWorkspaceProfilePersistenceError) throw error;
  throw new SellerWorkspaceProfilePersistenceError(error);
}

export class PostgreSqlSellerWorkspaceProfileRepository implements SellerWorkspaceProfileRepository {
  async createProfile(input: CreateSellerWorkspaceProfileInput): Promise<SellerWorkspaceProfile> {
    const sellerId = validateWorkspaceSellerId(input.sellerId);
    const displayName = normalizeWorkspaceDisplayName(input.displayName);
    const intendedPhone = normalizeIntendedWhatsappPhoneE164(input.intendedWhatsappPhoneE164);
    const logo = normalizeLogoMetadata(input.logo);
    const slugBase = normalizeWorkspaceSlugBase(displayName);
    const onboardingCompletedAt = input.onboardingCompletedAt ?? null;

    for (let attempt = 0; attempt < MAX_SLUG_INSERT_ATTEMPTS; attempt += 1) {
      const slug = buildSlugCandidate(slugBase, attempt === 0 ? undefined : randomSlugSuffix());
      try {
        const result = await executeDatabaseQuery<SellerWorkspaceProfileRow>({
          text: `
            INSERT INTO seller_workspace_profiles (
              seller_id,
              display_name,
              slug,
              intended_whatsapp_phone_e164,
              logo_object_key,
              logo_mime_type,
              onboarding_completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING ${PROFILE_COLUMNS}
          `,
          values: [sellerId, displayName, slug, intendedPhone ?? null, logo?.objectKey ?? null, logo?.mimeType ?? null, onboardingCompletedAt],
        });
        const row = result.rows[0];
        if (!row) throw new SellerWorkspaceProfilePersistenceError();
        return mapSellerWorkspaceProfile(row);
      } catch (error) {
        if (databaseCode(error) === "23505") {
          const exists = await this.findByTenantContext({ sellerId });
          if (exists) throw new SellerWorkspaceProfileAlreadyExistsError();
          continue;
        }
        mapCreateError(error);
      }
    }

    throw new SellerWorkspaceProfilePersistenceError();
  }

  async findByTenantContext(tenant: TenantContext): Promise<SellerWorkspaceProfile | null> {
    try {
      const result = await executeDatabaseQuery<SellerWorkspaceProfileRow>({
        text: `SELECT ${PROFILE_COLUMNS} FROM seller_workspace_profiles WHERE seller_id = $1 LIMIT 1`,
        values: [tenant.sellerId],
      });
      return result.rows[0] ? mapSellerWorkspaceProfile(result.rows[0]) : null;
    } catch (error) {
      mapPersistenceError(error);
    }
  }

  async updateDisplayName(tenant: TenantContext, displayName: string): Promise<SellerWorkspaceProfile | null> {
    const normalizedName = normalizeWorkspaceDisplayName(displayName);
    try {
      const result = await executeDatabaseQuery<SellerWorkspaceProfileRow>({
        text: `UPDATE seller_workspace_profiles SET display_name = $2, updated_at = NOW() WHERE seller_id = $1 RETURNING ${PROFILE_COLUMNS}`,
        values: [tenant.sellerId, normalizedName],
      });
      return result.rows[0] ? mapSellerWorkspaceProfile(result.rows[0]) : null;
    } catch (error) {
      mapPersistenceError(error);
    }
  }

  async updateIntendedPhone(tenant: TenantContext, intendedWhatsappPhoneE164?: string | null): Promise<SellerWorkspaceProfile | null> {
    const normalizedPhone = normalizeIntendedWhatsappPhoneE164(intendedWhatsappPhoneE164);
    try {
      const result = await executeDatabaseQuery<SellerWorkspaceProfileRow>({
        text: `UPDATE seller_workspace_profiles SET intended_whatsapp_phone_e164 = $2, updated_at = NOW() WHERE seller_id = $1 RETURNING ${PROFILE_COLUMNS}`,
        values: [tenant.sellerId, normalizedPhone ?? null],
      });
      return result.rows[0] ? mapSellerWorkspaceProfile(result.rows[0]) : null;
    } catch (error) {
      mapPersistenceError(error);
    }
  }

  async updateLogoMetadata(tenant: TenantContext, logo: SellerWorkspaceLogoMetadata): Promise<SellerWorkspaceProfile | null> {
    const normalizedLogo = normalizeLogoMetadata(logo);
    if (!normalizedLogo) throw new SellerWorkspaceProfilePersistenceError();
    try {
      const result = await executeDatabaseQuery<SellerWorkspaceProfileRow>({
        text: `UPDATE seller_workspace_profiles SET logo_object_key = $2, logo_mime_type = $3, updated_at = NOW() WHERE seller_id = $1 RETURNING ${PROFILE_COLUMNS}`,
        values: [tenant.sellerId, normalizedLogo.objectKey, normalizedLogo.mimeType],
      });
      return result.rows[0] ? mapSellerWorkspaceProfile(result.rows[0]) : null;
    } catch (error) {
      mapPersistenceError(error);
    }
  }

  async clearLogoMetadata(tenant: TenantContext): Promise<SellerWorkspaceProfile | null> {
    try {
      const result = await executeDatabaseQuery<SellerWorkspaceProfileRow>({
        text: `UPDATE seller_workspace_profiles SET logo_object_key = NULL, logo_mime_type = NULL, updated_at = NOW() WHERE seller_id = $1 RETURNING ${PROFILE_COLUMNS}`,
        values: [tenant.sellerId],
      });
      return result.rows[0] ? mapSellerWorkspaceProfile(result.rows[0]) : null;
    } catch (error) {
      mapPersistenceError(error);
    }
  }

  async onboardingProfileExists(tenant: TenantContext): Promise<boolean> {
    try {
      const result = await executeDatabaseQuery<ExistsRow>({
        text: "SELECT EXISTS(SELECT 1 FROM seller_workspace_profiles WHERE seller_id = $1) AS exists",
        values: [tenant.sellerId],
      });
      return result.rows[0]?.exists === true;
    } catch (error) {
      mapPersistenceError(error);
    }
  }
}

export const postgreSqlSellerWorkspaceProfileRepository = new PostgreSqlSellerWorkspaceProfileRepository();
