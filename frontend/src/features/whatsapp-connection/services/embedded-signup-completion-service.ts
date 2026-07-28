export type CompleteEmbeddedSignupInput = Readonly<{
  code: string;
  wabaId: string;
  phoneNumberId: string;
}>;

export type EmbeddedSignupCompletionResponse = Readonly<{
  success: boolean;
}>;

export type WhatsappConnectionErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "validation_failed"
  | "service_unavailable";

export type SafeWhatsappConnectionError = Readonly<{
  code: WhatsappConnectionErrorCode;
  message: string;
  status: number;
}>;

const DEFAULT_BACKEND_BASE_URL = "http://localhost:5000";

function backendBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_BACKEND_BASE_URL
  ).replace(/\/+$/u, "");
}

export class EmbeddedSignupCompletionServiceError extends Error implements SafeWhatsappConnectionError {
  readonly code: WhatsappConnectionErrorCode;
  readonly status: number;

  constructor(error: SafeWhatsappConnectionError) {
    super(error.message);
    this.name = "EmbeddedSignupCompletionServiceError";
    this.code = error.code;
    this.status = error.status;
  }
}

export type EmbeddedSignupCompletionService = Readonly<{
  complete(input: CompleteEmbeddedSignupInput): Promise<EmbeddedSignupCompletionResponse>;
}>;

function errorForStatus(response: Response): SafeWhatsappConnectionError {
  if (response.status === 400) {
    return { code: "validation_failed", message: "WhatsApp setup could not be verified. Please start the connection again.", status: response.status };
  }
  if (response.status === 401) {
    return { code: "unauthenticated", message: "Please sign in again before connecting WhatsApp.", status: response.status };
  }
  if (response.status === 403) {
    return { code: "forbidden", message: "You do not have permission to connect WhatsApp for this workspace.", status: response.status };
  }

  return {
    code: "service_unavailable",
    message: "WhatsApp connection verification is not available yet. Please try again later.",
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
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new EmbeddedSignupCompletionServiceError({
      code: "service_unavailable",
      message: "WhatsApp connection verification is not available yet. Please try again later.",
      status: 0,
    });
  }

  if (!response.ok) throw new EmbeddedSignupCompletionServiceError(errorForStatus(response));
  return response.json() as Promise<TResponse>;
}

export const httpEmbeddedSignupCompletionService: EmbeddedSignupCompletionService = {
  complete(input) {
    return requestJson<EmbeddedSignupCompletionResponse>("/api/whatsapp-connections/embedded-signup/complete", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
