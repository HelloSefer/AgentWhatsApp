const LOCAL_BACKEND_BASE_URL = "http://localhost:5000";

export class BackendHttpConfigurationError extends Error {
  constructor(message = "Backend URL configuration is missing.") {
    super(message);
    this.name = "BackendHttpConfigurationError";
  }
}

function configuredBackendBaseUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configured === undefined) return null;
  const trimmed = configured.trim().replace(/\/+$/u, "");
  if (!trimmed) throw new BackendHttpConfigurationError();
  return trimmed;
}

export function backendBaseUrl(): string {
  const configured = configuredBackendBaseUrl();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return LOCAL_BACKEND_BASE_URL;
  throw new BackendHttpConfigurationError();
}

export function backendUrl(path: string): string {
  return `${backendBaseUrl()}${path}`;
}

export function authenticatedBackendFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(backendUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

export const __backendHttpClientTesting = {
  LOCAL_BACKEND_BASE_URL,
};
