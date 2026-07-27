export type WorkspaceLogoMetadata = Readonly<{
  objectKey: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}>;

export type WorkspaceSummary = Readonly<{
  sellerId: string;
  displayName: string;
  intendedWhatsAppPhone?: string;
  logo?: WorkspaceLogoMetadata;
  role: "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
  whatsappStatus: "NOT_CONNECTED";
}>;

export type OnboardingStatus = Readonly<
  | { needsOnboarding: true; workspace?: undefined }
  | { needsOnboarding: false; workspace: WorkspaceSummary }
>;

export type CreateWorkspaceInput = Readonly<{
  storeName: string;
  intendedWhatsAppPhone?: string;
}>;

export type CreateWorkspaceResponse = Readonly<{
  status: "created" | "existing";
  needsOnboarding: false;
  workspace: WorkspaceSummary;
}>;

export type UploadLogoResponse = Readonly<{
  logo: WorkspaceLogoMetadata;
  whatsappStatus: "NOT_CONNECTED";
}>;

export type RemoveLogoResponse = Readonly<{
  logo: null;
  whatsappStatus: "NOT_CONNECTED";
}>;

export type SafeOnboardingErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "service_unavailable";

export type SafeOnboardingError = Readonly<{
  code: SafeOnboardingErrorCode;
  message: string;
  status: number;
  retryAfterSeconds?: number;
}>;
