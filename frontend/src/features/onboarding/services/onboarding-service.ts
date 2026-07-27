import type {
  CreateWorkspaceInput,
  CreateWorkspaceResponse,
  OnboardingStatus,
  RemoveLogoResponse,
  SafeOnboardingError,
  SafeOnboardingErrorCode,
  UploadLogoResponse,
} from "../types/onboarding-contracts";

const DEFAULT_BACKEND_BASE_URL = "http://localhost:5000";

function backendBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_BACKEND_BASE_URL
  ).replace(/\/+$/u, "");
}

export class OnboardingServiceError extends Error implements SafeOnboardingError {
  readonly code: SafeOnboardingErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(error: SafeOnboardingError) {
    super(error.message);
    this.name = "OnboardingServiceError";
    this.code = error.code;
    this.status = error.status;
    this.retryAfterSeconds = error.retryAfterSeconds;
  }
}

export type OnboardingService = Readonly<{
  status(): Promise<OnboardingStatus>;
  createWorkspace(input: CreateWorkspaceInput): Promise<CreateWorkspaceResponse>;
  uploadLogo(file: File): Promise<UploadLogoResponse>;
  removeLogo(): Promise<RemoveLogoResponse>;
}>;

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
}

function errorForStatus(response: Response): SafeOnboardingError {
  const retryAfter = retryAfterSeconds(response);

  if (response.status === 400) {
    return { code: "invalid_request", message: "Please check your workspace details and try again.", status: response.status };
  }
  if (response.status === 401) {
    return { code: "unauthenticated", message: "Please sign in to continue.", status: response.status };
  }
  if (response.status === 403) {
    return { code: "forbidden", message: "You do not have permission to change this workspace.", status: response.status };
  }
  if (response.status === 409) {
    return { code: "conflict", message: "This workspace needs a quick refresh before continuing.", status: response.status };
  }
  if (response.status === 413) {
    return { code: "payload_too_large", message: "Logo must be 2 MB or smaller.", status: response.status };
  }
  if (response.status === 429) {
    return {
      code: "rate_limited",
      message: retryAfter
        ? `Too many attempts. Try again in ${retryAfter} seconds.`
        : "Too many attempts. Please wait a moment and try again.",
      status: response.status,
      retryAfterSeconds: retryAfter,
    };
  }

  return {
    code: "service_unavailable",
    message: "Onboarding is temporarily unavailable. Please try again shortly.",
    status: response.status,
  };
}

async function requestJson<TResponse>(path: string, init: RequestInit): Promise<TResponse> {
  let response: Response;

  try {
    response = await fetch(`${backendBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch {
    throw new OnboardingServiceError({
      code: "service_unavailable",
      message: "Onboarding is temporarily unavailable. Please try again shortly.",
      status: 0,
    });
  }

  if (!response.ok) throw new OnboardingServiceError(errorForStatus(response));
  return response.json() as Promise<TResponse>;
}

export const httpOnboardingService: OnboardingService = {
  status() {
    return requestJson<OnboardingStatus>("/api/onboarding/status", { method: "GET" });
  },

  createWorkspace(input) {
    return requestJson<CreateWorkspaceResponse>("/api/onboarding/workspace", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  uploadLogo(file) {
    const formData = new FormData();
    formData.append("file", file);
    return requestJson<UploadLogoResponse>("/api/onboarding/logo", {
      method: "POST",
      body: formData,
    });
  },

  removeLogo() {
    return requestJson<RemoveLogoResponse>("/api/onboarding/logo", {
      method: "DELETE",
    });
  },
};
