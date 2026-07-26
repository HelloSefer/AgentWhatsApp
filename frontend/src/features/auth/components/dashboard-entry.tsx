"use client";

import { SignOutButton } from "./sign-out-button";
import { useAuthSession } from "../hooks/use-auth-session";

export function DashboardEntry() {
  const { memberships, needsOnboarding, user } = useAuthSession();
  const userName = user?.emailNormalized || "there";
  const initial = userName.charAt(0).toUpperCase();

  return (
    <section aria-labelledby="dashboard-heading" className="rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard preview</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl" id="dashboard-heading">
            Welcome to AgentWhatsApp
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Your full sales workspace will be built in the next phase.
          </p>
        </div>
        <SignOutButton />
      </div>
      <div className="mt-8 flex items-center gap-4 rounded-xl border border-marketing-border bg-marketing-canvas p-4">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-marketing-subtle text-base font-semibold text-marketing-primary">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{userName}</p>
          <p className="truncate text-sm text-muted-foreground">
            {`${memberships.length} active membership${memberships.length === 1 ? "" : "s"}${needsOnboarding ? " · onboarding needed" : ""}`}
          </p>
        </div>
      </div>
    </section>
  );
}
