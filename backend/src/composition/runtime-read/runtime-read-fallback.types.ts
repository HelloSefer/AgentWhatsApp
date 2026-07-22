export type RuntimeReadFallbackReason =
  | "disabled"
  | "invalid_tenant"
  | "not_found"
  | "database_unavailable"
  | "persistence_error";

export type RuntimeReadSource = "legacy" | "persistence";
