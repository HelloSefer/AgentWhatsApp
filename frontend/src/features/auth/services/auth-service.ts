import type {
  AuthSession,
  BackendAuthSession,
  LoginInput,
  SafeAuthError,
  SafeAuthErrorCode,
  SignupInput,
} from "../types/auth-contracts";

const DEFAULT_BACKEND_BASE_URL = "http://localhost:5000";

function backendBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_BACKEND_BASE_URL
  ).replace(/\/+$/u, "");
}

export const authEndpoints = {
  googleStart: () => `${backendBaseUrl()}/api/auth/google/start`,
} as const;

export class AuthServiceError extends Error implements SafeAuthError {
  readonly code: SafeAuthErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(error: SafeAuthError) {
    super(error.message);
    this.name = "AuthServiceError";
    this.code = error.code;
    this.status = error.status;
    this.retryAfterSeconds = error.retryAfterSeconds;
  }
}

export type AuthService = Readonly<{
  signup(input: SignupInput): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthSession>;
  logout(): Promise<void>;
  currentUser(): Promise<AuthSession | null>;
}>;

function sessionFromBackend(value: BackendAuthSession): AuthSession {
  return {
    user: value.user,
    memberships: value.activeMemberships,
    needsOnboarding: value.needsOnboarding,
  };
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return undefined;

  return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
}

function authErrorForStatus(response: Response): SafeAuthError {
  const retryAfter = retryAfterSeconds(response);

  if (response.status === 400) {
    return { code: "invalid_request", message: "Please check your details and try again.", status: response.status };
  }

  if (response.status === 401) {
    return { code: "invalid_credentials", message: "The email or password you entered is incorrect.", status: response.status };
  }

  if (response.status === 409) {
    return { code: "email_exists", message: "An account already exists for this email.", status: response.status };
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
    message: "Authentication is temporarily unavailable. Please try again shortly.",
    status: response.status,
  };
}

async function requestJson<TResponse>(
  path: string,
  init: RequestInit,
): Promise<TResponse> {
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
    throw new AuthServiceError({
      code: "service_unavailable",
      message: "Authentication is temporarily unavailable. Please try again shortly.",
      status: 0,
    });
  }

  if (!response.ok) {
    throw new AuthServiceError(authErrorForStatus(response));
  }

  return response.json() as Promise<TResponse>;
}

export const httpAuthService: AuthService = {
  async signup(input) {
    const response = await requestJson<BackendAuthSession>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return sessionFromBackend(response);
  },

  async login(input) {
    const response = await requestJson<BackendAuthSession>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return sessionFromBackend(response);
  },

  async logout() {
    let response: Response;

    try {
      response = await fetch(`${backendBaseUrl()}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new AuthServiceError({
        code: "service_unavailable",
        message: "Authentication is temporarily unavailable. Please try again shortly.",
        status: 0,
      });
    }

    if (!response.ok && response.status !== 401) {
      throw new AuthServiceError(authErrorForStatus(response));
    }
  },

  async currentUser() {
    let response: Response;

    try {
      response = await fetch(`${backendBaseUrl()}/api/auth/me`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new AuthServiceError({
        code: "service_unavailable",
        message: "Authentication is temporarily unavailable. Please try again shortly.",
        status: 0,
      });
    }

    if (response.status === 401) return null;

    if (!response.ok) {
      throw new AuthServiceError(authErrorForStatus(response));
    }

    return sessionFromBackend((await response.json()) as BackendAuthSession);
  },
};
