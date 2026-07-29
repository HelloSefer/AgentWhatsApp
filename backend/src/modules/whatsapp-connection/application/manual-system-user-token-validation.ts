export const MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const;

export const MANUAL_SYSTEM_USER_OPTIONAL_SCOPES = [
  "business_management",
] as const;

export const MANUAL_SYSTEM_USER_SCOPE_CONTRACT = {
  required: MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES,
  optional: MANUAL_SYSTEM_USER_OPTIONAL_SCOPES,
} as const;

export function missingManualSystemUserRequiredScope(scopes: readonly string[]): string | null {
  const granted = new Set(scopes);
  return MANUAL_SYSTEM_USER_REQUIRED_WHATSAPP_SCOPES.find((scope) => !granted.has(scope)) ?? null;
}
