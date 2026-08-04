import type Redis from "ioredis";
import { DevelopmentTenantService } from "./development-tenant.service";

const prefixes = ["session", "buffer", "lock"] as const;
export class DevelopmentTenantConversationResetService {
  constructor(private readonly tenantService: DevelopmentTenantService, private readonly valkey: Pick<Redis, "scan" | "del">) {}
  // Executes only after the entry point has established its own authorization policy.
  async executeTrustedReset(): Promise<Readonly<{ deletedKeyCount: number }>> {
    const tenant = await this.tenantService.resolveCurrent();
    const keys = new Set<string>();
    for (const prefix of prefixes) {
      let cursor = "0";
      do { const [next, batch] = await this.valkey.scan(cursor, "MATCH", `${prefix}:${tenant.sellerId}:*`, "COUNT", 100); cursor = next; batch.forEach((key) => keys.add(key)); } while (cursor !== "0");
    }
    if (keys.size) await this.valkey.del(...keys);
    return { deletedKeyCount: keys.size };
  }
}
