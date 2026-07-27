import { siteConfig } from "@/config/site";
import type { AuthSession } from "../types/auth-contracts";

const DEFAULT_AUTH_REDIRECT = siteConfig.routes.dashboard;
const ONBOARDING_REDIRECT = siteConfig.routes.onboarding;
const ALLOWED_AUTH_REDIRECT_PREFIXES = [siteConfig.routes.dashboard, siteConfig.routes.onboarding] as const;
const AUTH_LOOP_PATHS = new Set<string>([
  siteConfig.routes.login,
  siteConfig.routes.signUp,
]);

function pathnameFromInternalPath(value: string): string | null {
  try {
    return new URL(value, "https://agentwhatsapp.local").pathname;
  } catch {
    return null;
  }
}

function isAllowedInternalPath(value: string): boolean {
  return ALLOWED_AUTH_REDIRECT_PREFIXES.some((path) => value === path || value.startsWith(`${path}/`) || value.startsWith(`${path}?`));
}

export function safeAuthRedirect(value: string | null | undefined): string {
  if (!value) return DEFAULT_AUTH_REDIRECT;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value && decoded !== decodeURIComponent(decoded)) return DEFAULT_AUTH_REDIRECT;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
  if (/%/u.test(value)) return DEFAULT_AUTH_REDIRECT;
  if (/[\u0000-\u001F\u007F\\]/u.test(value)) return DEFAULT_AUTH_REDIRECT;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return DEFAULT_AUTH_REDIRECT;
  if (/^\/?\s*javascript:/iu.test(trimmed)) return DEFAULT_AUTH_REDIRECT;
  if (!isAllowedInternalPath(trimmed)) return DEFAULT_AUTH_REDIRECT;
  const pathname = pathnameFromInternalPath(trimmed);
  if (!pathname || AUTH_LOOP_PATHS.has(pathname)) return DEFAULT_AUTH_REDIRECT;
  if (pathname === siteConfig.routes.onboarding) return ONBOARDING_REDIRECT;
  if (pathname === siteConfig.routes.dashboard) return DEFAULT_AUTH_REDIRECT;
  if (pathname.startsWith(`${siteConfig.routes.dashboard}/`)) return trimmed;
  return trimmed;
}

export function safeAuthRedirectFromRawSearch(search: string): string {
  const rawSearch = search.startsWith("?") ? search.slice(1) : search;
  const redirectPair = rawSearch
    .split("&")
    .map((entry) => entry.split("=", 2))
    .find(([key]) => key === "redirectTo" || key === "next");

  if (!redirectPair?.[1] || /%/u.test(redirectPair[1])) return DEFAULT_AUTH_REDIRECT;

  try {
    return safeAuthRedirect(decodeURIComponent(redirectPair[1].replace(/\+/gu, " ")));
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}

export function postAuthRedirectForSession(session: AuthSession, requestedRedirect: string): string {
  if (session.needsOnboarding) return ONBOARDING_REDIRECT;
  const safeRedirect = safeAuthRedirect(requestedRedirect);
  return pathnameFromInternalPath(safeRedirect) === siteConfig.routes.onboarding
    ? DEFAULT_AUTH_REDIRECT
    : safeRedirect;
}
