import Redis from "ioredis";
import { env } from "../../config/env";

let valkeyClient: Redis | null = null;

export function getValkeyClient(): Redis {
  if (valkeyClient) {
    return valkeyClient;
  }

  valkeyClient = new Redis(env.valkeyUrl, {
    lazyConnect: true,
  });

  valkeyClient.on("connect", () => {
    console.log("✅ Valkey connected");
  });

  valkeyClient.on("ready", () => {
    console.log("✅ Valkey ready");
  });

  valkeyClient.on("error", (error) => {
    console.error("❌ Valkey error", error);
  });

  valkeyClient.on("close", () => {
    console.log("🔌 Valkey connection closed");
  });

  return valkeyClient;
}

export async function closeValkeyClient(): Promise<void> {
  if (!valkeyClient) {
    return;
  }

  await valkeyClient.quit();
  valkeyClient = null;
}
