export type RuntimeReadMode = "enabled" | "disabled";

export function resolveRuntimeReadMode(value: string | undefined): RuntimeReadMode {
  return value?.trim().toLowerCase() === "true" ? "enabled" : "disabled";
}
