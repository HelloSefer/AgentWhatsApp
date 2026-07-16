import { Bot, Circle, PanelsTopLeft } from "lucide-react";
import { ConversationPanel } from "./conversation-panel";
import { OrderActivityCard } from "./order-activity-card";
import { OrderSummaryCard } from "./order-summary-card";

export function ProductVisual() {
  return (
    <section
      aria-label="AgentWhatsApp sales workspace preview"
      className="relative mx-auto w-full max-w-[36rem] scroll-mt-28"
      id="conversation-demo"
    >
      <div aria-hidden="true" className="absolute inset-x-8 top-10 -z-10 h-72 rounded-full bg-marketing-muted/55 blur-3xl" />

      <div className="relative overflow-hidden rounded-2xl border border-marketing-border bg-marketing-surface p-1.5 shadow-[0_28px_70px_-34px_oklch(0.2_0.045_155/0.48)] sm:rounded-[1.75rem] sm:p-2.5">
        <header className="flex items-center justify-between gap-2.5 px-2 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-marketing-primary text-marketing-primary-foreground sm:size-8 sm:rounded-lg">
              <PanelsTopLeft aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">Commerce workspace</p>
              <p className="truncate text-[0.6875rem] text-muted-foreground">Order automation preview</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-marketing-border bg-marketing-subtle px-1.5 py-1 text-[0.625rem] font-semibold text-marketing-primary sm:gap-1.5 sm:px-2.5 sm:text-[0.6875rem]">
            <Circle aria-hidden="true" className="size-2 fill-current" />
            Demo mode
          </span>
        </header>

        <div className="grid min-w-0 gap-2 rounded-xl border border-marketing-border bg-marketing-canvas p-2 sm:gap-2.5 sm:rounded-[1.25rem] sm:p-3 sm:grid-cols-[minmax(0,1fr)_10.75rem]">
          <ConversationPanel />
          <div className="grid min-w-0 gap-2 sm:gap-2.5 sm:content-start">
            <div className="flex items-center gap-2 rounded-lg border border-marketing-border bg-marketing-surface px-2.5 py-2 text-xs font-medium text-foreground sm:rounded-xl sm:px-3 sm:py-2.5">
              <Bot aria-hidden="true" className="size-4 shrink-0 text-marketing-primary" />
              Order assistant
            </div>
            <OrderSummaryCard />
            <OrderActivityCard />
          </div>
        </div>
      </div>
    </section>
  );
}
