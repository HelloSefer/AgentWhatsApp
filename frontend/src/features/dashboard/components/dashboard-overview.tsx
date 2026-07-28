"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { useOnboardingStatus } from "@/features/onboarding/hooks/use-onboarding";
import { whatsappConnectionQueryKey } from "@/features/whatsapp-connection/components/customer-owned-meta-app-wizard-types";
import { httpEmbeddedSignupCompletionService } from "@/features/whatsapp-connection/services/embedded-signup-completion-service";
import { DashboardActivityEmptyState } from "./dashboard-activity-empty-state";
import { DashboardOverviewHeader } from "./dashboard-overview-header";
import { buildDashboardOverviewViewModel } from "./dashboard-overview-view-model";
import { LaunchProgressCard } from "./launch-progress-card";
import { OperationalStatusGrid } from "./operational-status-grid";

function DashboardOverviewLoading() {
  return (
    <section aria-busy="true" aria-labelledby="dashboard-loading-heading" className="space-y-4">
      <div>
        <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl" id="dashboard-loading-heading">
          Loading your overview
        </h2>
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    </section>
  );
}

function DashboardOverviewError({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <section aria-labelledby="dashboard-error-heading" className="rounded-xl border border-marketing-border bg-white p-5 shadow-[0_18px_36px_-32px_oklch(0.2_0.04_155/0.35)] sm:p-6">
      <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground" id="dashboard-error-heading">
        We could not load your overview
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        Please retry. The dashboard uses backend-confirmed workspace state before showing setup readiness.
      </p>
      <Button className="mt-5 min-h-11" onClick={retry} type="button">
        <RefreshCw aria-hidden="true" />
        Retry
      </Button>
    </section>
  );
}

export function DashboardOverview() {
  const auth = useAuthSession();
  const onboardingQuery = useOnboardingStatus(auth.isAuthenticated && !auth.needsOnboarding);
  const whatsappQuery = useQuery({
    queryKey: whatsappConnectionQueryKey,
    queryFn: () => httpEmbeddedSignupCompletionService.loadCurrent(),
    enabled: auth.isAuthenticated && !auth.needsOnboarding,
    retry: false,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const workspace = onboardingQuery.data?.needsOnboarding === false ? onboardingQuery.data.workspace : null;
  const isLoading = onboardingQuery.isLoading || onboardingQuery.isPending || whatsappQuery.isLoading || whatsappQuery.isPending;

  if (isLoading) return <DashboardOverviewLoading />;
  if (onboardingQuery.error || !workspace) {
    return <DashboardOverviewError retry={() => void onboardingQuery.refetch()} />;
  }

  const overview = buildDashboardOverviewViewModel(workspace, whatsappQuery.data?.connection ?? null);

  return (
    <div className="space-y-5">
      <DashboardOverviewHeader overview={overview} />
      <LaunchProgressCard overview={overview} />
      <OperationalStatusGrid overview={overview} />
      <DashboardActivityEmptyState />
    </div>
  );
}
