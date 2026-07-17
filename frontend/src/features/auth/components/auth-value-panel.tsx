import { BadgeCheck, MessagesSquare } from "lucide-react";

const benefits = [
  "Organized customer conversations",
  "Structured order management",
  "One workspace for your sales team",
] as const;

export function AuthValuePanel() {
  return (
    <aside className="hidden min-h-full flex-col justify-between rounded-2xl border border-marketing-primary/15 bg-marketing-primary p-10 text-marketing-accent-foreground shadow-[0_24px_48px_-34px_oklch(0.2_0.04_155/0.65)] lg:flex xl:p-12">
      <div>
        <span className="flex size-11 items-center justify-center rounded-xl bg-marketing-accent-foreground/12 text-marketing-accent-foreground">
          <MessagesSquare aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-10 text-xs font-semibold tracking-[0.12em] text-marketing-accent-foreground/70 uppercase">AgentWhatsApp workspace</p>
        <h2 className="mt-4 max-w-md text-4xl leading-[1.08] font-semibold tracking-[-0.04em] text-balance">Your WhatsApp sales workspace</h2>
        <p className="mt-5 max-w-md text-base leading-7 text-marketing-accent-foreground/75">
          Manage conversations, customer details, order confirmation, and sales activity from one organized dashboard.
        </p>
      </div>
      <ul className="mt-12 grid gap-4 text-sm font-medium text-marketing-accent-foreground/90" role="list">
        {benefits.map((benefit) => (
          <li className="flex items-center gap-3" key={benefit}>
            <BadgeCheck aria-hidden="true" className="size-5 shrink-0 text-marketing-accent-foreground" />
            {benefit}
          </li>
        ))}
      </ul>
    </aside>
  );
}
