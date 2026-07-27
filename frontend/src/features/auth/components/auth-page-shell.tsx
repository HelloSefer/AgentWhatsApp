import type { ReactNode } from "react";
import { Container } from "@/components/shared/container";
import type { AuthAppearance } from "../config/auth-screen-content";
import { AuthBrandHeader } from "./auth-brand-header";

type AuthPageShellProps = Readonly<{
  appearance?: AuthAppearance;
  aside?: ReactNode;
  children: ReactNode;
}>;

export function AuthPageShell({ appearance = "light", aside, children }: AuthPageShellProps) {
  const isDark = appearance === "dark";

  if (isDark) {
    return (
      <main className="relative isolate min-h-dvh overflow-x-clip bg-[#02090d] bg-[radial-gradient(circle_at_35%_42%,rgba(8,201,96,0.08),transparent_31%),linear-gradient(135deg,#02080c_0%,#06131a_55%,#02080d_100%)] text-slate-50 xl:h-dvh xl:max-h-dvh xl:min-h-dvh xl:overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-px -z-10 rounded-[1.35rem] border border-white/[0.09]" />
        <div aria-hidden="true" className="pointer-events-none absolute top-[-16rem] left-[24%] -z-10 size-[38rem] rounded-full bg-[#0ac760]/8 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[-12rem] bottom-[-18rem] -z-10 size-[36rem] rounded-full bg-[#0d9f59]/8 blur-3xl" />
        <Container className="flex min-h-dvh max-w-none flex-col px-5 py-6 sm:px-8 xl:grid xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,57fr)_minmax(0,43fr)] xl:gap-[clamp(3rem,4vw,4.25rem)] xl:px-[clamp(3.5rem,3.9vw,4rem)] xl:py-[clamp(2.75rem,5.4vh,3.125rem)]">
          <div className="contents xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)]">
            <AuthBrandHeader appearance={appearance} />
            {aside ? <div className="hidden min-h-0 min-w-0 xl:block">{aside}</div> : null}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center pt-6 xl:h-full xl:w-full xl:items-start xl:justify-end xl:pt-0 xl:pr-[clamp(0.625rem,calc(3.55vw_-_2.4rem),1.25rem)]">
            {children}
          </div>
        </Container>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-marketing-canvas">
      <Container className="flex min-h-screen max-w-[75rem] flex-col px-5 sm:px-6 lg:px-8">
        <AuthBrandHeader />
        <div className="flex flex-1 items-center justify-center pb-8 sm:pb-12 lg:pb-16">
          {children}
        </div>
      </Container>
    </main>
  );
}
