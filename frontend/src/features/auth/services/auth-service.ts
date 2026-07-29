import type {
  AuthSession,
  BackendAuthSession,
  EmailVerificationConfirmInput,
  EmailVerificationRequestInput,
  LoginInput,
  PasswordForgotInput,
  PasswordResetInput,
  SafeAuthError,
  SafeAuthErrorCode,
  SignupInput,
} from "../types/auth-contracts";
import { authenticatedBackendFetch, backendUrl } from "@/lib/backend-http-client";

export const authEndpoints = {
  googleStart: () => backendUrl("/api/auth/google/start"),
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
  requestEmailVerification(input: EmailVerificationRequestInput): Promise<void>;
  confirmEmailVerification(input: EmailVerificationConfirmInput): Promise<void>;
  requestPasswordReset(input: PasswordForgotInput): Promise<void>;
  resetPassword(input: PasswordResetInput): Promise<void>;
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

type AuthErrorContext = "default" | "token";

function authErrorForStatus(response: Response, context: AuthErrorContext = "default"): SafeAuthError {
  const retryAfter = retryAfterSeconds(response);

  if (response.status === 400) {
    if (context === "token") {
      return {
        code: "invalid_token",
        message: "This link is invalid, expired, or has already been used.",
        status: response.status,
      };
    }

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
  context?: AuthErrorContext,
): Promise<TResponse> {
  let response: Response;

  try {
    response = await authenticatedBackendFetch(path, init);
  } catch {
    throw new AuthServiceError({
      code: "service_unavailable",
      message: "Authentication is temporarily unavailable. Please try again shortly.",
      status: 0,
    });
  }

  if (!response.ok) {
    throw new AuthServiceError(authErrorForStatus(response, context));
  }

  return response.json() as Promise<TResponse>;
}

async function requestVoid(path: string, init: RequestInit, context?: AuthErrorContext): Promise<void> {
  await requestJson<unknown>(path, init, context);
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
      response = await fetch(backendUrl("/api/auth/logout"), {
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
      response = await fetch(backendUrl("/api/auth/me"), {
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

  async requestEmailVerification(input) {
    await requestVoid("/api/auth/email-verification/request", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async confirmEmailVerification(input) {
    await requestVoid(
      "/api/auth/email-verification/confirm",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      "token",
    );
  },

  async requestPasswordReset(input) {
    await requestVoid("/api/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async resetPassword(input) {
    await requestVoid(
      "/api/auth/password/reset",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      "token",
    );
  },
};
