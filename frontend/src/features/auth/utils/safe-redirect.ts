import { siteConfig } from "@/config/site";

const DEFAULT_AUTH_REDIRECT = "/dashboard";

export function safeAuthRedirect(value: string | null | undefined): string {
  if (!value) return DEFAULT_AUTH_REDIRECT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_AUTH_REDIRECT;
  if (value.startsWith("/api/")) return DEFAULT_AUTH_REDIRECT;
  if (value === siteConfig.routes.login || value === siteConfig.routes.signUp) return DEFAULT_AUTH_REDIRECT;
  return value;
}
