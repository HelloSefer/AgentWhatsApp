import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SellerLogoStorage, StoreSellerLogoInput } from "../../contracts/seller-logo-storage";
import { SellerLogoStorageError } from "../../domain/seller-logo.errors";
import type { SellerLogoMetadata } from "../../domain/seller-logo.types";
import { validateSellerLogoObjectKey } from "../../domain/seller-logo.validation";

export class LocalSellerLogoStorageAdapter implements SellerLogoStorage {
  private readonly rootDirectory: string;

  constructor(rootDirectory = path.resolve(process.cwd(), "storage", "seller-logos")) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async store(input: StoreSellerLogoInput): Promise<SellerLogoMetadata> {
    const objectKey = validateSellerLogoObjectKey(input.objectKey);
    const targetPath = this.pathForObjectKey(objectKey);
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, input.bytes, { flag: "wx" });
      return { objectKey, mimeType: input.mimeType };
    } catch (error) {
      throw new SellerLogoStorageError(error);
    }
  }

  async delete(objectKey: string): Promise<void> {
    const safeObjectKey = validateSellerLogoObjectKey(objectKey);
    try {
      await rm(this.pathForObjectKey(safeObjectKey), { force: true });
    } catch (error) {
      throw new SellerLogoStorageError(error);
    }
  }

  private pathForObjectKey(objectKey: string): string {
    const fullPath = path.resolve(this.rootDirectory, objectKey);
    const rootWithSeparator = this.rootDirectory.endsWith(path.sep) ? this.rootDirectory : `${this.rootDirectory}${path.sep}`;
    if (!fullPath.startsWith(rootWithSeparator)) throw new SellerLogoStorageError();
    return fullPath;
  }
}
