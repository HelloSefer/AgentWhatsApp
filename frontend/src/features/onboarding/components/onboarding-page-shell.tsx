"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Container } from "@/components/shared/container";
import { SiteLogo } from "@/components/shared/site-logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { useOnboardingStatus } from "../hooks/use-onboarding";
import { OnboardingWorkspaceForm } from "./onboarding-workspace-form";

export function OnboardingPageShell() {
  const router = useRouter();
  const auth = useAuthSession();
  const statusQuery = useOnboardingStatus(auth.isAuthenticated);

  useEffect(() => {
    if (auth.isUnauthenticated) {
      router.replace("/login?redirectTo=/onboarding");
    }
  }, [auth.isUnauthenticated, router]);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    if (auth.needsOnboarding === false && statusQuery.data?.needsOnboarding === false) {
      router.replace("/dashboard");
    }
  }, [auth.isAuthenticated, auth.needsOnboarding, router, statusQuery.data?.needsOnboarding]);

  const isLoading = auth.isLoading || (auth.isAuthenticated && statusQuery.isLoading);

  if (isLoading || auth.isUnauthenticated || statusQuery.data?.needsOnboarding === false) {
    return (
      <main className="min-h-screen bg-marketing-canvas px-4 py-6 sm:px-6 sm:py-10">
        <Container className="mx-auto max-w-5xl">
          <SiteLogo />
          <section aria-busy="true" aria-labelledby="onboarding-loading-heading" className="mx-auto mt-10 max-w-2xl rounded-2xl border border-marketing-border bg-marketing-surface p-5 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:mt-14 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Workspace setup</p>
            <h1 className="mt-3 text-2xl font-semibold text-foreground sm:text-3xl" id="onboarding-loading-heading">
              Checking your workspace
            </h1>
            <div className="mt-6 space-y-3">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          </section>
        </Container>
      </main>
    );
  }

  if (auth.error || statusQuery.error) {
    return (
      <main className="min-h-screen bg-marketing-canvas px-4 py-6 sm:px-6 sm:py-10">
        <Container className="mx-auto max-w-5xl">
          <SiteLogo />
          <section aria-labelledby="onboarding-error-heading" className="mx-auto mt-10 max-w-2xl rounded-2xl border border-marketing-border bg-marketing-surface p-5 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:mt-14 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Workspace setup</p>
            <h1 className="mt-3 text-2xl font-semibold text-foreground sm:text-3xl" id="onboarding-error-heading">
              We could not load your onboarding state
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Please retry before creating a workspace. This keeps your current account and workspace state as the source of truth.
            </p>
            <Button className="mt-6 min-h-11" onClick={() => statusQuery.refetch()} type="button">
              Retry
            </Button>
          </section>
        </Container>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-marketing-canvas px-4 py-6 sm:px-6 sm:py-10">
      <Container className="mx-auto max-w-5xl">
        <SiteLogo />
        <OnboardingWorkspaceForm />
      </Container>
    </main>
  );
}
