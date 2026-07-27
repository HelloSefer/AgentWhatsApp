import { SellerWorkspaceProfilePersistenceError } from "../../domain/seller-workspace-profile.errors";
import type { SellerWorkspaceProfile } from "../../domain/seller-workspace-profile.types";

export type SellerWorkspaceProfileRow = Readonly<{
  seller_id: string;
  display_name: string;
  slug: string;
  intended_whatsapp_phone_e164: string | null;
  logo_object_key: string | null;
  logo_mime_type: string | null;
  onboarding_completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}>;

function optionalDate(value: Date | string | null): Date | undefined {
  if (value === null) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new SellerWorkspaceProfilePersistenceError();
  return parsed;
}

function requiredDate(value: Date | string): Date {
  const parsed = optionalDate(value);
  if (!parsed) throw new SellerWorkspaceProfilePersistenceError();
  return parsed;
}

export function mapSellerWorkspaceProfile(row: SellerWorkspaceProfileRow): SellerWorkspaceProfile {
  return {
    sellerId: row.seller_id,
    displayName: row.display_name,
    slug: row.slug,
    intendedWhatsappPhoneE164: row.intended_whatsapp_phone_e164 ?? undefined,
    logoObjectKey: row.logo_object_key ?? undefined,
    logoMimeType: row.logo_mime_type ?? undefined,
    onboardingCompletedAt: optionalDate(row.onboarding_completed_at),
    createdAt: requiredDate(row.created_at),
    updatedAt: requiredDate(row.updated_at),
  };
}
