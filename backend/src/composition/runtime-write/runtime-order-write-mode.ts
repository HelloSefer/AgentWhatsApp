export type RuntimeOrderWriteMode = "enabled" | "disabled";

export function resolveRuntimeOrderWriteMode(value: string | undefined): RuntimeOrderWriteMode {
  return value === "true" ? "enabled" : "disabled";
}
