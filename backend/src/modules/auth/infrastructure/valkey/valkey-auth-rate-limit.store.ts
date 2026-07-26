import { getValkeyClient } from "../../../../infrastructure/valkey/valkey.client";
import type { AuthRateLimitStore } from "../../application/auth-rate-limiter";

export class ValkeyAuthRateLimitStore implements AuthRateLimitStore {
  async increment(key: string, windowSeconds: number): Promise<Readonly<{ count: number; retryAfterSeconds: number }>> {
    const client = getValkeyClient();
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowSeconds);
    const ttl = await client.ttl(key);
    return { count, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  }

  async clear(key: string): Promise<void> {
    await getValkeyClient().del(key);
  }
}
