import type { DatabaseErrorCategory } from "../errors/database.errors";

export type DatabaseHealthResult = Readonly<{
  status: "available" | "unavailable";
  reachable: boolean;
  latencyMs?: number;
  errorCategory?: DatabaseErrorCategory;
}>;
