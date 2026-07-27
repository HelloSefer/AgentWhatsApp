import { randomUUID } from "node:crypto";
import { createTenantContext } from "../../../infrastructure/database";
import { SellerLogoValidationError } from "./seller-logo.errors";
import {
  SELLER_LOGO_MAX_BYTES,
  SELLER_LOGO_MIME_TYPES,
  type SellerLogoMetadata,
  type SellerLogoMimeType,
} from "./seller-logo.types";

const MIME_TO_EXTENSION: Readonly<Record<SellerLogoMimeType, string>> = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
});

function normalizeMimeType(value: unknown): SellerLogoMimeType {
  if (typeof value !== "string") throw new SellerLogoValidationError();
  const mimeType = value.trim().toLocaleLowerCase("en-US");
  if (!SELLER_LOGO_MIME_TYPES.includes(mimeType as SellerLogoMimeType)) {
    throw new SellerLogoValidationError();
  }
  return mimeType as SellerLogoMimeType;
}

function hasPngSignature(bytes: Buffer): boolean {
  return bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
}

function hasJpegSignature(bytes: Buffer): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9;
}

function hasWebpSignature(bytes: Buffer): boolean {
  return bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function signatureMatches(bytes: Buffer, mimeType: SellerLogoMimeType): boolean {
  if (mimeType === "image/png") return hasPngSignature(bytes);
  if (mimeType === "image/jpeg") return hasJpegSignature(bytes);
  return hasWebpSignature(bytes);
}

export function validateSellerLogoUpload(bytes: unknown, mimeType: unknown): Readonly<{
  bytes: Buffer;
  mimeType: SellerLogoMimeType;
}> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > SELLER_LOGO_MAX_BYTES) {
    throw new SellerLogoValidationError();
  }
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (!signatureMatches(bytes, normalizedMimeType)) throw new SellerLogoValidationError();
  return { bytes, mimeType: normalizedMimeType };
}

export function createSellerLogoObjectKey(sellerId: string, mimeType: SellerLogoMimeType): string {
  const tenant = createTenantContext(sellerId);
  return `seller-logos/${tenant.sellerId}/${randomUUID().replace(/-/gu, "")}.${MIME_TO_EXTENSION[mimeType]}`;
}

export function validateSellerLogoObjectKey(value: unknown): string {
  if (typeof value !== "string") throw new SellerLogoValidationError();
  const objectKey = value.trim();
  if (
    !objectKey ||
    objectKey.length > 512 ||
    objectKey.startsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.includes("://") ||
    objectKey.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !/^seller-logos\/[A-Za-z0-9._-]+\/[a-f0-9]{32}\.(png|jpg|webp)$/u.test(objectKey)
  ) {
    throw new SellerLogoValidationError();
  }
  return objectKey;
}

export function validateSellerLogoMetadata(metadata: SellerLogoMetadata): SellerLogoMetadata {
  return {
    objectKey: validateSellerLogoObjectKey(metadata.objectKey),
    mimeType: normalizeMimeType(metadata.mimeType),
  };
}
