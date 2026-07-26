import { siteConfig } from "@/config/site";

const DEFAULT_AUTH_REDIRECT = "/dashboard";
const ALLOWED_AUTH_REDIRECT_PREFIXES = ["/dashboard"] as const;

function isAllowedDashboardPath(value: string): boolean {
  return ALLOWED_AUTH_REDIRECT_PREFIXES.some((path) => value === path || value.startsWith(`${path}/`) || value.startsWith(`${path}?`));
}

export function safeAuthRedirect(value: string | null | undefined): string {
  if (!value) return DEFAULT_AUTH_REDIRECT;
  try {
    if (value !== decodeURI(value)) return DEFAULT_AUTH_REDIRECT;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
  if (/[\u0000-\u001F\u007F\\]/u.test(value)) return DEFAULT_AUTH_REDIRECT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_AUTH_REDIRECT;
  if (!isAllowedDashboardPath(value)) return DEFAULT_AUTH_REDIRECT;
  if (value === siteConfig.routes.login || value === siteConfig.routes.signUp) return DEFAULT_AUTH_REDIRECT;
  return value;
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
