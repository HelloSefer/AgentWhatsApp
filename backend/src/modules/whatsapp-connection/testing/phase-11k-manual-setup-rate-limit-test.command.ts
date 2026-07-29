import { readFileSync } from "node:fs";
import { closeDatabasePool, getDatabasePoolState } from "../../../infrastructure/database";
import { AuthRateLimiter, InMemoryAuthRateLimitStore } from "../../auth";
import { rateLimitAuth } from "../../auth/http/auth-rate-limit.middleware";

type TestCase = Readonly<{ name: string; passed: boolean }>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function requestProbe(userId: string, sellerId: string, ip = "127.0.0.1"): Record<string, unknown> {
  return { ip, auth: { userId }, tenant: { sellerId } };
}

function responseProbe(): {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  status(status: number): { json(body: unknown): void };
} {
  const probe = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    status(status: number) {
      this.statusCode = status;
      return {
        json: (body: unknown) => {
          this.body = body;
        },
      };
    },
  };
  return probe;
}

async function invokeManualLimiter(input: {
  limiter: AuthRateLimiter;
  action: "manual_whatsapp_setup" | "manual_whatsapp_discover";
  userId: string;
  sellerId: string;
}): Promise<{ statusCode?: number; body?: unknown; retryAfter?: string; nextCalled: boolean }> {
  const req = requestProbe(input.userId, input.sellerId);
  const res = responseProbe();
  let nextCalled = false;
  const middleware = rateLimitAuth(
    input.limiter,
    input.action,
    (request) => {
      const auth = (request as Partial<{ auth?: { userId?: string } }>).auth?.userId ?? "unknown";
      const sellerId = (request as Partial<{ tenant?: { sellerId?: string } }>).tenant?.sellerId ?? "unknown";
      return `${auth}:${sellerId}`;
    },
    { issueCode: "RATE_LIMITED" },
  );
  await middleware(req as never, res as never, () => {
    nextCalled = true;
  });
  return { statusCode: res.statusCode, body: res.body, retryAfter: res.headers["retry-after"], nextCalled };
}

async function main(): Promise<void> {
  await closeDatabasePool();
  add("manual setup rate-limit imports do not initialize PostgreSQL", !getDatabasePoolState().initialized);

  const setupStore = new InMemoryAuthRateLimitStore();
  const setupLimiter = new AuthRateLimiter(setupStore);
  for (let index = 0; index < 5; index += 1) {
    const allowed = await invokeManualLimiter({ limiter: setupLimiter, action: "manual_whatsapp_setup", userId: "user_a", sellerId: "seller_a" });
    add(`manual setup request ${index + 1} is allowed before bound`, allowed.nextCalled && allowed.statusCode === undefined);
  }
  const limited = await invokeManualLimiter({ limiter: setupLimiter, action: "manual_whatsapp_setup", userId: "user_a", sellerId: "seller_a" });
  const limitedBody = typeof limited.body === "object" && limited.body !== null ? limited.body as Record<string, unknown> : {};
  add("manual setup limiter returns HTTP 429 after configured bound", limited.statusCode === 429 && !limited.nextCalled);
  add("manual setup limiter returns Retry-After", typeof limited.retryAfter === "string" && Number(limited.retryAfter) > 0);
  add("manual setup limiter returns bounded safe issue code", limitedBody.issueCode === "RATE_LIMITED" && limitedBody.code === "RATE_LIMITED");
  add("manual setup limiter response exposes no raw identity or key material", !JSON.stringify(limited.body).includes("seller_a") && !JSON.stringify(limited.body).includes("user_a") && setupStore.keys.every((key) => !key.includes("seller_a") && !key.includes("user_a")));

  const distinctSeller = await invokeManualLimiter({ limiter: setupLimiter, action: "manual_whatsapp_setup", userId: "user_a", sellerId: "seller_b" });
  add("distinct seller identity does not share the setup seller bucket", distinctSeller.nextCalled && distinctSeller.statusCode === undefined);
  const discoverAfterSetupLimit = await invokeManualLimiter({ limiter: setupLimiter, action: "manual_whatsapp_discover", userId: "user_a", sellerId: "seller_a" });
  add("manual discovery is not falsely blocked by the setup limiter bucket", discoverAfterSetupLimit.nextCalled && discoverAfterSetupLimit.statusCode === undefined);

  const discoverLimiter = new AuthRateLimiter(new InMemoryAuthRateLimitStore());
  for (let index = 0; index < 20; index += 1) {
    await invokeManualLimiter({ limiter: discoverLimiter, action: "manual_whatsapp_discover", userId: "user_c", sellerId: "seller_c" });
  }
  const discoverLimited = await invokeManualLimiter({ limiter: discoverLimiter, action: "manual_whatsapp_discover", userId: "user_c", sellerId: "seller_c" });
  add("local-development manual discovery default remains bounded", discoverLimited.statusCode === 429);

  const routeSource = readFileSync("src/modules/whatsapp-connection/whatsapp-connection.routes.ts", "utf8");
  add("manual route source uses distinct manual mutation limiter actions", /manual_whatsapp_setup/u.test(routeSource) && /manual_whatsapp_discover/u.test(routeSource) && /manual_whatsapp_select_assets/u.test(routeSource) && /manual_whatsapp_configure_webhook/u.test(routeSource) && /manual_whatsapp_finalize/u.test(routeSource));
  add("production manual setup default remains strict", setupStore.keys.some((key) => key.includes("manual_whatsapp_setup")) && limited.statusCode === 429);
  add("manual setup limiter test leaves PostgreSQL closed", !getDatabasePoolState().initialized);

  const failed = cases.filter((entry) => !entry.passed);
  process.stdout.write(`${JSON.stringify({ summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length }, cases })}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async () => {
  await closeDatabasePool();
  process.stderr.write(`${JSON.stringify({ ok: false, message: "Manual WhatsApp setup rate-limit test failed safely." })}\n`);
  process.exitCode = 1;
});
