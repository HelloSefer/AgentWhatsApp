import type { DashboardOverviewViewModel } from "./dashboard-overview.types";

type DashboardOverviewHeaderProps = Readonly<{
  overview: DashboardOverviewViewModel;
}>;

export function DashboardOverviewHeader({ overview }: DashboardOverviewHeaderProps) {
  return (
    <section aria-labelledby="dashboard-overview-heading" className="space-y-2">
      <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Dashboard</p>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl" id="dashboard-overview-heading">
        Welcome back, {overview.storeDisplayName}
      </h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">{overview.launchDescription}</p>
    </section>
  );
}
