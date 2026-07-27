import type { NextFunction, Request, Response } from "express";
import { SELLER_LOGO_MAX_BYTES } from "../../seller-logo";
import {
  OnboardingMultipartPayloadTooLargeError,
  OnboardingMultipartValidationError,
  sendOnboardingError,
} from "./onboarding-http.errors";

const MAX_MULTIPART_BYTES = SELLER_LOGO_MAX_BYTES + 16 * 1024;

export type MultipartImageRequest = Request & {
  uploadedImage?: Readonly<{
    bytes: Buffer;
    mimeType: string;
  }>;
};

function boundaryFrom(contentType: unknown): string {
  if (typeof contentType !== "string") throw new OnboardingMultipartValidationError();
  const match = contentType.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))$/iu);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200 || boundary.includes("\r") || boundary.includes("\n")) {
    throw new OnboardingMultipartValidationError();
  }
  return boundary;
}

function parseMultipartImage(body: Buffer, boundary: string): Readonly<{ bytes: Buffer; mimeType: string }> {
  const delimiter = `--${boundary}`;
  const parts = body.toString("latin1").split(delimiter);
  for (const part of parts) {
    if (!part.includes("Content-Disposition:")) continue;
    if (!/name="(?:file|logo|image)"/iu.test(part)) continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) throw new OnboardingMultipartValidationError();
    const rawHeaders = part.slice(0, headerEnd);
    const contentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/iu)?.[1]?.trim();
    if (!contentType) throw new OnboardingMultipartValidationError();
    let content = part.slice(headerEnd + 4);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    if (content.endsWith("--")) content = content.slice(0, -2);
    const bytes = Buffer.from(content, "latin1");
    if (bytes.length > SELLER_LOGO_MAX_BYTES) throw new OnboardingMultipartPayloadTooLargeError();
    return { bytes, mimeType: contentType };
  }
  throw new OnboardingMultipartValidationError();
}

export function multipartImage(maxBytes = MAX_MULTIPART_BYTES) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const boundary = boundaryFrom(req.headers["content-type"]);
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes) throw new OnboardingMultipartPayloadTooLargeError();
        chunks.push(buffer);
      }
      (req as MultipartImageRequest).uploadedImage = parseMultipartImage(Buffer.concat(chunks), boundary);
      next();
    } catch (error) {
      sendOnboardingError(res, error);
    }
  };
}
