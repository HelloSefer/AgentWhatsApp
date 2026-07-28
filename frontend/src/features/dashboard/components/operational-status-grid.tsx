import type { DashboardOverviewViewModel } from "./dashboard-overview.types";
import { OperationalStatusCard } from "./operational-status-card";

type OperationalStatusGridProps = Readonly<{
  overview: DashboardOverviewViewModel;
}>;

export function OperationalStatusGrid({ overview }: OperationalStatusGridProps) {
  return (
    <section aria-labelledby="operational-status-heading" className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground" id="operational-status-heading">
          Operational status
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Current capability readiness based on available dashboard state.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 min-[1500px]:grid-cols-4">
        {overview.operationalCards.map((card) => (
          <OperationalStatusCard card={card} key={card.title} />
        ))}
      </div>
    </section>
  );
}
