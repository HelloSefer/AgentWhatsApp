import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { SellerLogoStorage, StoreSellerLogoInput } from "../../contracts/seller-logo-storage";
import { SellerLogoStorageError } from "../../domain/seller-logo.errors";
import type { SellerLogoMetadata } from "../../domain/seller-logo.types";
import { validateSellerLogoObjectKey } from "../../domain/seller-logo.validation";

export type R2S3Client = Readonly<{
  send(command: PutObjectCommand | DeleteObjectCommand): Promise<unknown>;
}>;

export type CloudflareR2SellerLogoStorageAdapterConfiguration = Readonly<{
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  client?: R2S3Client;
}>;

function createClient(configuration: CloudflareR2SellerLogoStorageAdapterConfiguration): R2S3Client {
  return new S3Client({
    region: "auto",
    endpoint: configuration.endpoint,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  });
}

function isMissingObject(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "NoSuchKey" || error.name === "NotFound");
}

export class CloudflareR2SellerLogoStorageAdapter implements SellerLogoStorage {
  private readonly client: R2S3Client;
  private readonly bucketName: string;

  constructor(configuration: CloudflareR2SellerLogoStorageAdapterConfiguration) {
    this.client = configuration.client ?? createClient(configuration);
    this.bucketName = configuration.bucketName;
  }

  async store(input: StoreSellerLogoInput): Promise<SellerLogoMetadata> {
    const objectKey = validateSellerLogoObjectKey(input.objectKey);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        Body: input.bytes,
        ContentType: input.mimeType,
      }));
      return { objectKey, mimeType: input.mimeType };
    } catch (error) {
      throw new SellerLogoStorageError(error);
    }
  }

  async delete(objectKey: string): Promise<void> {
    const safeObjectKey = validateSellerLogoObjectKey(objectKey);
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: safeObjectKey,
      }));
    } catch (error) {
      if (isMissingObject(error)) return;
      throw new SellerLogoStorageError(error);
    }
  }
}
