export const SELLER_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const SELLER_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SellerLogoMimeType = typeof SELLER_LOGO_MIME_TYPES[number];

export type SellerLogoMetadata = Readonly<{
  objectKey: string;
  mimeType: SellerLogoMimeType;
}>;

export type SellerLogoUploadInput = Readonly<{
  bytes: Buffer;
  mimeType: string;
}>;
