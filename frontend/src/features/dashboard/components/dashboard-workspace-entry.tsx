"use client";

import { AlertCircle, CheckCircle2, Circle, ImageIcon, PackageOpen, PlugZap, RefreshCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { useOnboardingStatus } from "@/features/onboarding/hooks/use-onboarding";
import type { WorkspaceSummary } from "@/features/onboarding/types/onboarding-contracts";
import { readableWhatsappStatus, workspaceInitials } from "../utils/workspace-display";

type ChecklistItem = Readonly<{
  label: string;
  description: string;
  state: "complete" | "incomplete" | "not_connected";
}>;

function LoadingDashboard() {
  return (
    <section aria-busy="true" aria-labelledby="dashboard-loading-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:p-8">
      <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl" id="dashboard-loading-heading">
        Loading your workspace
      </h1>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    </section>
  );
}

function ErrorDashboard({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <section aria-labelledby="dashboard-error-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:p-8">
      <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl" id="dashboard-error-heading">
        We could not load your workspace
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
        Please retry. We will not assume setup is complete until the backend confirms your workspace.
      </p>
      <Button className="mt-6 min-h-11" onClick={retry} type="button">
        <RefreshCw aria-hidden="true" />
        Retry
      </Button>
    </section>
  );
}

function WorkspaceIdentityCard({ workspace }: Readonly<{ workspace: WorkspaceSummary }>) {
  const hasLogo = Boolean(workspace.logo);

  return (
    <section aria-labelledby="workspace-identity-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-5 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.35)] sm:p-6">
      <div className="flex flex-col gap-5 min-[360px]:flex-row min-[360px]:items-start">
        <div aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-marketing-subtle text-xl font-semibold text-marketing-primary ring-1 ring-marketing-border">
          {workspaceInitials(workspace.displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Workspace identity</p>
          <h2 className="mt-2 truncate text-2xl font-semibold text-foreground" id="workspace-identity-heading">
            {workspace.displayName}
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge className="min-h-6" variant="outline">
              <UserRound aria-hidden="true" />
              {workspace.role}
            </Badge>
            <Badge className="min-h-6 border-destructive/25 bg-destructive/10 text-destructive" variant="outline">
              <PlugZap aria-hidden="true" />
              {readableWhatsappStatus(workspace.whatsappStatus)}
            </Badge>
            {hasLogo ? (
              <Badge className="min-h-6 border-marketing-primary/25 bg-marketing-subtle text-marketing-primary" variant="outline">
                <ImageIcon aria-hidden="true" />
                Logo uploaded
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-marketing-border bg-marketing-canvas p-4">
          <dt className="font-medium text-muted-foreground">Intended WhatsApp number</dt>
          <dd className="mt-1 font-semibold text-foreground">{workspace.intendedWhatsAppPhone || "Not added yet"}</dd>
        </div>
        <div className="rounded-xl border border-marketing-border bg-marketing-canvas p-4">
          <dt className="font-medium text-muted-foreground">Logo</dt>
          <dd className="mt-1 font-semibold text-foreground">{hasLogo ? "Uploaded" : "Optional"}</dd>
        </div>
      </dl>
    </section>
  );
}

function ChecklistRow({ item }: Readonly<{ item: ChecklistItem }>) {
  const complete = item.state === "complete";
  const notConnected = item.state === "not_connected";

  return (
    <li className="flex gap-3 rounded-xl border border-marketing-border bg-marketing-canvas p-4">
      {complete ? (
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-marketing-primary" />
      ) : notConnected ? (
        <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      ) : (
        <Circle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{item.label}</p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.description}</p>
      </div>
    </li>
  );
}

function SetupChecklist({ workspace }: Readonly<{ workspace: WorkspaceSummary }>) {
  const items: ChecklistItem[] = [
    { label: "Workspace created", description: "Your seller workspace exists and is ready for setup.", state: "complete" },
    { label: "Store identity", description: "Your display name is saved from onboarding.", state: "complete" },
    {
      label: "Logo",
      description: workspace.logo ? "Logo metadata is saved. Media delivery will arrive in a later phase." : "Optional. Add a logo later from workspace settings.",
      state: workspace.logo ? "complete" : "incomplete",
    },
    { label: "WhatsApp connection", description: "Not connected. Connection setup is available in the next setup step.", state: "not_connected" },
    { label: "Product catalog", description: "Not configured yet. Catalog setup will appear when an authoritative setup state is available.", state: "incomplete" },
  ];

  return (
    <section aria-labelledby="setup-checklist-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-5 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.35)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Setup state</p>
          <h2 className="mt-2 text-2xl font-semibold text-foreground" id="setup-checklist-heading">
            Next steps
          </h2>
        </div>
        <Button aria-disabled="true" className="min-h-11 cursor-not-allowed opacity-70" disabled type="button" variant="outline">
          <PlugZap aria-hidden="true" />
          Available in the next setup step
        </Button>
      </div>
      <ul className="mt-6 grid gap-3">
        {items.map((item) => <ChecklistRow item={item} key={item.label} />)}
      </ul>
    </section>
  );
}

function EmptyStartingState() {
  return (
    <section aria-labelledby="dashboard-empty-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-5 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.35)] sm:p-6">
      <PackageOpen aria-hidden="true" className="size-8 text-marketing-primary" />
      <h2 className="mt-4 text-2xl font-semibold text-foreground" id="dashboard-empty-heading">
        Ready for your first setup tasks
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Product catalog, WhatsApp connection, orders, and analytics will appear when their real backend states are available. No mock activity is shown here.
      </p>
    </section>
  );
}

export function DashboardWorkspaceEntry() {
  const auth = useAuthSession();
  const statusQuery = useOnboardingStatus(auth.isAuthenticated && !auth.needsOnboarding);
  const workspace = statusQuery.data?.needsOnboarding === false ? statusQuery.data.workspace : null;

  if (statusQuery.isLoading || statusQuery.isPending) return <LoadingDashboard />;
  if (statusQuery.error || !workspace) return <ErrorDashboard retry={() => statusQuery.refetch()} />;

  return (
    <div className="space-y-5">
      <section aria-labelledby="dashboard-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl" id="dashboard-heading">
              Welcome, {workspace.displayName}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Your workspace is created. Finish the remaining setup steps when each backend capability becomes available.
            </p>
          </div>
          <SignOutButton />
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <WorkspaceIdentityCard workspace={workspace} />
        <SetupChecklist workspace={workspace} />
      </div>
      <EmptyStartingState />
    </div>
  );
}
