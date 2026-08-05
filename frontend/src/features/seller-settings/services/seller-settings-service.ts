import { authenticatedBackendFetch } from "@/lib/backend-http-client";
import type {
  SellerSettingsDto,
  SellerSettingsFieldError,
  SellerSettingsSafeError,
  SellerSettingsSafeErrorCode,
  SellerSettingsUpdateInput,
} from "../types/seller-settings-contracts";

export class SellerSettingsServiceError extends Error implements SellerSettingsSafeError {
  readonly code: SellerSettingsSafeErrorCode;
  readonly status: number;
  readonly fieldErrors?: readonly SellerSettingsFieldError[];

  constructor(error: SellerSettingsSafeError) {
    super(error.message);
    this.name = "SellerSettingsServiceError";
    this.code = error.code;
    this.status = error.status;
    this.fieldErrors = error.fieldErrors;
  }
}

export type SellerSettingsService = Readonly<{
  read(): Promise<SellerSettingsDto>;
  update(input: SellerSettingsUpdateInput): Promise<SellerSettingsDto>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fieldErrors(value: unknown): readonly SellerSettingsFieldError[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.errors)) return undefined;
  const errors = value.errors
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => ({
      field: typeof entry.field === "string" ? entry.field : "settings",
      code: typeof entry.code === "string" ? entry.code : "INVALID",
    }));
  return errors.length ? errors : undefined;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorForStatus(response: Response, payload: unknown): SellerSettingsSafeError {
  if (response.status === 400) {
    return {
      code: "invalid_request",
      message: "Please review the highlighted settings and try again.",
      status: response.status,
      fieldErrors: fieldErrors(payload),
    };
  }
  if (response.status === 401) return { code: "unauthenticated", message: "Please sign in to continue.", status: response.status };
  if (response.status === 403) return { code: "forbidden", message: "You do not have permission to manage store settings.", status: response.status };
  if (response.status === 409) return { code: "conflict", message: "Settings changed elsewhere. Reload before saving again.", status: response.status };
  if (response.status === 422) {
    return {
      code: "domain_validation",
      message: "These settings are not accepted by the backend yet.",
      status: response.status,
      fieldErrors: fieldErrors(payload),
    };
  }
  return {
    code: "service_unavailable",
    message: "Store settings are temporarily unavailable. Please try again shortly.",
    status: response.status,
  };
}

async function requestJson<TResponse>(path: string, init: RequestInit): Promise<TResponse> {
  let response: Response;
  try {
    response = await authenticatedBackendFetch(path, init);
  } catch {
    throw new SellerSettingsServiceError({
      code: "service_unavailable",
      message: "Store settings are temporarily unavailable. Please try again shortly.",
      status: 0,
    });
  }

  const payload = await safeJson(response);
  if (!response.ok) throw new SellerSettingsServiceError(errorForStatus(response, payload));
  return payload as TResponse;
}

export const httpSellerSettingsService: SellerSettingsService = {
  read() {
    return requestJson<SellerSettingsDto>("/api/seller/settings", { method: "GET" });
  },

  update(input) {
    return requestJson<SellerSettingsDto>("/api/seller/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
};
