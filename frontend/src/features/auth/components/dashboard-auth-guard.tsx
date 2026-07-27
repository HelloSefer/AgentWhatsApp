"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "../hooks/use-auth-session";

type DashboardAuthGuardProps = Readonly<{
  children: ReactNode;
}>;

function dashboardReturnPath(pathname: string | null): string {
  if (!pathname || pathname !== "/dashboard") return "/dashboard";
  return pathname;
}

export function DashboardAuthGuard({ children }: DashboardAuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuthSession();

  useEffect(() => {
    if (!auth.isUnauthenticated) return;
    router.replace(`/login?redirectTo=${dashboardReturnPath(pathname)}`);
  }, [auth.isUnauthenticated, pathname, router]);

  useEffect(() => {
    if (!auth.isAuthenticated || !auth.needsOnboarding) return;
    router.replace("/onboarding");
  }, [auth.isAuthenticated, auth.needsOnboarding, router]);

  if (auth.error) {
    return (
      <section aria-labelledby="dashboard-session-error-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:p-8">
        <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl" id="dashboard-session-error-heading">
          We could not confirm your session
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
          Please retry before opening your workspace. Your backend session remains the source of truth.
        </p>
        <Button className="mt-6 min-h-11" onClick={() => window.location.reload()} type="button">
          Retry
        </Button>
      </section>
    );
  }

  if (auth.isLoading || auth.isUnauthenticated || (auth.isAuthenticated && auth.needsOnboarding)) {
    return (
      <section aria-busy="true" aria-labelledby="dashboard-session-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:p-8">
        <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl" id="dashboard-session-heading">
          Checking your session
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
          We are confirming access before loading your workspace.
        </p>
      </section>
    );
  }

  if (!auth.isAuthenticated) return null;

  return <>{children}</>;
}
