import {
  BarChart3,
  Building2,
  Cloud,
  Languages,
  LockKeyhole,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
} from "lucide-react";
import type { AuthAppearance } from "../config/auth-screen-content";
import { AuthSceneArtwork } from "./auth-scene-artwork";

const lightValuePoints = [
  {
    description: "Manage customer messages and follow-up from one focused workspace.",
    icon: MessagesSquare,
    title: "Conversations in one place",
  },
  {
    description: "Protected access backed by secure HTTP-only sessions.",
    icon: ShieldCheck,
    title: "Security built in",
  },
  {
    description: "Keep orders, customer context, and sales activity organized.",
    icon: ShoppingBag,
    title: "A workspace built for sales",
  },
] as const;

const darkValuePoints = [
  {
    description: "Assist customer conversations with structured sales context.",
    icon: MessageSquareText,
    title: "Smart conversations",
  },
  {
    description: "Collect, confirm, and track order details.",
    icon: ShoppingCart,
    title: "Order capture",
  },
  {
    description: "Keep conversations and orders visible in one workspace.",
    icon: BarChart3,
    title: "Sales overview",
  },
  {
    description: "Protected access with secure backend sessions.",
    icon: ShieldCheck,
    title: "Secure sessions",
  },
] as const;

const statusItems = [
  { icon: Cloud, label: "Official WhatsApp Cloud API" },
  { icon: LockKeyhole, label: "Secure HTTP-only sessions" },
  { icon: MapPin, label: "Built for Moroccan commerce" },
  { icon: Languages, label: "Darija-ready sales automation" },
] as const;

type AuthValuePanelProps = Readonly<{
  appearance?: AuthAppearance;
}>;

export function AuthValuePanel({ appearance = "light" }: AuthValuePanelProps) {
  const isDark = appearance === "dark";

  if (isDark) {
    return (
      <section
        aria-labelledby="auth-value-heading"
        className="relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden pt-[clamp(1rem,2.2vh,1.5rem)]"
      >
        <AuthSceneArtwork />
        <div className="relative z-10 max-w-[32rem]">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#1edb78]/20 bg-[#0b1d15]/75 px-3 py-1.5 text-xs font-semibold text-[#34e788] shadow-[0_0_24px_rgba(24,211,112,0.08)]">
            <Sparkles aria-hidden="true" className="size-3.5" />
            AI-powered · Built for business
          </p>
          <p
            className="mt-[clamp(1.5rem,3vh,1.75rem)] max-w-[33rem] text-[clamp(2rem,5.2vh,3rem)] leading-[1.04] font-semibold tracking-[-0.055em] text-white"
            id="auth-value-heading"
          >
            <span className="block">Turn WhatsApp</span>
            <span className="block">
              into your <span className="text-[#20d875]">sales channel.</span>
            </span>
          </p>
          <p className="mt-[clamp(0.8rem,2.2vh,1.25rem)] max-w-[27rem] text-[clamp(0.875rem,1.9vh,1.125rem)] leading-[1.6] text-slate-300">
            Automate conversations, capture orders, and grow your business with intelligent AI.
          </p>
          <ul className="mt-[clamp(0.875rem,2.35vh,1.375rem)] grid max-w-[28rem] gap-[clamp(0.65rem,2vh,1.125rem)]" role="list">
            {darkValuePoints.map((point) => {
              const Icon = point.icon;

              return (
                <li className="flex items-center gap-[clamp(0.65rem,1.5vh,0.875rem)]" key={point.title}>
                  <span className="flex size-[clamp(2.25rem,5.7vh,3.25rem)] shrink-0 items-center justify-center rounded-[clamp(0.65rem,1.35vh,0.875rem)] border border-[#1edb78]/15 bg-[#0a1b14]/85 text-[#2be583] shadow-[0_10px_28px_rgba(0,0,0,0.24)]">
                    <Icon aria-hidden="true" className="size-[clamp(1rem,2.1vh,1.25rem)]" />
                  </span>
                  <div>
                    <p className="text-[clamp(0.8125rem,1.7vh,0.9375rem)] leading-tight font-semibold text-slate-100">{point.title}</p>
                    <p className="mt-[clamp(0.15rem,0.5vh,0.3rem)] text-[clamp(0.75rem,1.45vh,0.875rem)] leading-[1.35] text-slate-400">{point.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="relative z-10 w-full max-w-[48rem]">
          <div className="flex max-w-[33.5rem] items-center gap-4 rounded-xl border border-white/10 bg-[#08131a]/90 px-[clamp(0.9rem,1.5vw,1.25rem)] py-[clamp(0.75rem,1.6vh,0.875rem)] shadow-[0_16px_42px_rgba(0,0,0,0.24)] backdrop-blur-sm">
            <div className="flex -space-x-2">
              {[Building2, Store, MessagesSquare].map((Icon, index) => (
                <span
                  className="flex size-[clamp(2rem,4.5vh,2.75rem)] items-center justify-center rounded-full border-2 border-[#08131a] bg-[#10261c] text-[#32e387]"
                  key={index}
                >
                  <Icon aria-hidden="true" className="size-[clamp(0.85rem,1.8vh,1.125rem)]" />
                </span>
              ))}
            </div>
            <div className="min-w-0">
              <p className="text-[clamp(0.7rem,1.55vh,0.875rem)] font-semibold text-slate-100">Designed for commerce teams</p>
              <p className="mt-0.5 text-xs leading-[1.35] text-slate-400">
                Conversation-to-order workflows for focused sales operations
              </p>
            </div>
            <MapPin aria-hidden="true" className="ml-auto size-[clamp(1rem,2vh,1.25rem)] shrink-0 text-[#2de483]" />
          </div>
          <ul className="mt-[clamp(1rem,2.5vh,1.5rem)] grid grid-cols-4 gap-x-[clamp(0.6rem,1.6vw,1.25rem)]" role="list">
            {statusItems.map((item) => {
              const Icon = item.icon;

              return (
                <li className="flex min-w-0 items-center gap-[clamp(0.35rem,0.7vw,0.5rem)] text-xs leading-[1.35] text-slate-400" key={item.label}>
                  <span className="flex size-[clamp(1.5rem,3vh,1.75rem)] shrink-0 items-center justify-center rounded-lg border border-[#20d875]/15 bg-[#091b13] text-[#26de7d]">
                    <Icon aria-hidden="true" className="size-[clamp(0.7rem,1.45vh,0.875rem)]" />
                  </span>
                  {item.label}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="auth-value-heading" className="relative max-w-[33rem] py-8">
      <div
        aria-hidden="true"
        className="absolute -top-6 -left-14 -z-10 size-72 rounded-full bg-[radial-gradient(circle,rgba(197,235,207,0.55)_0%,rgba(230,246,234,0.22)_58%,transparent_74%)]"
      />
      <p className="inline-flex items-center gap-2 rounded-full border border-marketing-primary/15 bg-white/70 px-3 py-1.5 text-xs font-semibold tracking-[0.06em] text-marketing-primary shadow-sm backdrop-blur-sm">
        <Sparkles aria-hidden="true" className="size-3.5" />
        AI workspace for WhatsApp commerce
      </p>
      <h2 className="mt-6 text-[2.75rem] leading-[1.06] font-semibold tracking-[-0.05em] text-balance text-foreground xl:text-[3.25rem]" id="auth-value-heading">
        Keep every customer conversation moving toward a sale.
      </h2>
      <p className="mt-5 max-w-[30rem] text-base leading-7 text-muted-foreground">
        AgentWhatsApp brings conversations, order details, and day-to-day sales work into one clear operating space.
      </p>
      <ul className="mt-9 grid gap-4" role="list">
        {lightValuePoints.map((point) => {
          const Icon = point.icon;

          return (
            <li className="flex gap-3.5" key={point.title}>
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-marketing-primary/15 bg-white/80 text-marketing-primary shadow-sm">
                <Icon aria-hidden="true" className="size-[1.125rem]" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{point.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{point.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
