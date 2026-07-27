import { SellerLogoStorageConfigurationError } from "../domain/seller-logo-configuration.errors";

export type SellerLogoStorageProvider = "local" | "r2";

export type SellerLogoStorageConfiguration = Readonly<
  | { provider: "local" }
  | {
    provider: "r2";
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  }
>;

function requiredSecret(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new SellerLogoStorageConfigurationError();
  return value.trim();
}

function normalizeProvider(value: unknown): SellerLogoStorageProvider {
  const provider = typeof value === "string" && value.trim()
    ? value.trim().toLocaleLowerCase("en-US")
    : "local";
  if (provider !== "local" && provider !== "r2") throw new SellerLogoStorageConfigurationError();
  return provider;
}

function validateEndpoint(value: unknown): string {
  const endpoint = requiredSecret(value);
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
      throw new SellerLogoStorageConfigurationError();
    }
    return endpoint.replace(/\/+$/u, "");
  } catch (error) {
    if (error instanceof SellerLogoStorageConfigurationError) throw error;
    throw new SellerLogoStorageConfigurationError();
  }
}

export function validateSellerLogoStorageConfiguration(input: Readonly<{
  provider?: unknown;
  endpoint?: unknown;
  accessKeyId?: unknown;
  secretAccessKey?: unknown;
  bucketName?: unknown;
}>): SellerLogoStorageConfiguration {
  const provider = normalizeProvider(input.provider);
  if (provider === "local") return { provider };

  return {
    provider,
    endpoint: validateEndpoint(input.endpoint),
    accessKeyId: requiredSecret(input.accessKeyId),
    secretAccessKey: requiredSecret(input.secretAccessKey),
    bucketName: requiredSecret(input.bucketName),
  };
}
