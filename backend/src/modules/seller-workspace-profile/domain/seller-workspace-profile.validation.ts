import { validateSellerId } from "../../seller";
import { SellerWorkspaceProfileValidationError } from "./seller-workspace-profile.errors";
import type { SellerWorkspaceLogoMetadata } from "./seller-workspace-profile.types";

const DISPLAY_NAME_MAX_LENGTH = 120;
const SLUG_MAX_LENGTH = 160;
const LOGO_OBJECT_KEY_MAX_LENGTH = 512;
const SAFE_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function isDefaultSellerLike(value: string): boolean {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/gu, "-") === "default-seller";
}

export function normalizeWorkspaceDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new SellerWorkspaceProfileValidationError();
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > DISPLAY_NAME_MAX_LENGTH || isDefaultSellerLike(normalized)) {
    throw new SellerWorkspaceProfileValidationError();
  }
  return normalized;
}

export function normalizeIntendedWhatsappPhoneE164(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new SellerWorkspaceProfileValidationError();
  const compact = value.replace(/[\s().-]+/gu, "").trim();
  if (!compact) return undefined;
  if (!/^\+[1-9][0-9]{1,14}$/u.test(compact)) throw new SellerWorkspaceProfileValidationError();
  return compact;
}

export function normalizeLogoMetadata(value: SellerWorkspaceLogoMetadata | null | undefined): SellerWorkspaceLogoMetadata | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value.objectKey !== "string" || typeof value.mimeType !== "string") {
    throw new SellerWorkspaceProfileValidationError();
  }

  const objectKey = value.objectKey.trim();
  const mimeType = value.mimeType.trim().toLocaleLowerCase("en-US");
  if (
    !objectKey ||
    objectKey.length > LOGO_OBJECT_KEY_MAX_LENGTH ||
    objectKey.startsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.includes("://") ||
    objectKey.split("/").some((segment) => segment === "." || segment === "..") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(objectKey) ||
    !SAFE_LOGO_MIME_TYPES.has(mimeType)
  ) {
    throw new SellerWorkspaceProfileValidationError();
  }

  return { objectKey, mimeType };
}

export function normalizeWorkspaceSlugBase(displayName: string): string {
  const base = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
  return (base || "workspace").slice(0, SLUG_MAX_LENGTH).replace(/-+$/u, "") || "workspace";
}

export function buildSlugCandidate(base: string, suffix?: string): string {
  if (!suffix) return base;
  const safeSuffix = suffix
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "")
    .slice(0, 12);
  if (!safeSuffix) throw new SellerWorkspaceProfileValidationError();
  const prefix = base.slice(0, Math.max(1, SLUG_MAX_LENGTH - safeSuffix.length - 1)).replace(/-+$/u, "");
  return `${prefix}-${safeSuffix}`;
}

export function validateWorkspaceSellerId(value: unknown): string {
  try {
    return validateSellerId(value);
  } catch {
    throw new SellerWorkspaceProfileValidationError();
  }
}
