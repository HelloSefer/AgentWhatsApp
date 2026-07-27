export type SellerWorkspaceProfile = Readonly<{
  sellerId: string;
  displayName: string;
  slug: string;
  intendedWhatsappPhoneE164?: string;
  logoObjectKey?: string;
  logoMimeType?: string;
  onboardingCompletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}>;

export type SellerWorkspaceLogoMetadata = Readonly<{
  objectKey: string;
  mimeType: string;
}>;
