import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { siteConfig } from "@/config/site";
import type { AuthAppearance, AuthScreenContent, AuthScreenMode } from "../config/auth-screen-content";
import { AuthForm } from "./auth-form";
import { GoogleAuthButton } from "./google-auth-button";

type AuthPanelProps = Readonly<{
  appearance?: AuthAppearance;
  mode: AuthScreenMode;
  content: AuthScreenContent;
  hasSignInError: boolean;
}>;

export function AuthPanel({ appearance = "light", mode, content, hasSignInError }: AuthPanelProps) {
  const headingId = `${mode}-heading`;
  const isDark = appearance === "dark";

  if (!isDark) {
    return (
      <section
        aria-labelledby={headingId}
        className="w-full max-w-[33.75rem] rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_24px_48px_-36px_oklch(0.2_0.04_155/0.45)] sm:p-8 lg:p-10"
      >
        <p className="text-xs font-semibold tracking-[0.11em] text-marketing-primary uppercase">{content.eyebrow}</p>
        <h1
          className="mt-4 text-3xl leading-[1.12] font-semibold tracking-[-0.04em] text-foreground sm:text-[2.5rem]"
          id={headingId}
        >
          {content.title}
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">{content.description}</p>
        {hasSignInError ? (
          <p className="mt-6 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground" role="alert">
            We couldn’t complete Google sign-in. Please try again.
          </p>
        ) : null}
        <div className="mt-8">
          <GoogleAuthButton label={content.googleActionLabel} />
        </div>
        <div className="mt-6 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-marketing-border" />
          <span className="text-xs font-medium text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-marketing-border" />
        </div>
        <AuthForm mode={mode} />
        <p className="mt-6 flex gap-2.5 text-xs leading-5 text-muted-foreground">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-marketing-primary" />
          AgentWhatsApp uses secure HTTP-only backend sessions. Passwords and Google sign-in are handled by the backend.
        </p>
        <p className="mt-8 border-t border-marketing-border pt-6 text-sm text-muted-foreground">
          {content.alternatePrompt}{" "}
          <Link
            className="font-semibold text-marketing-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={content.alternateHref}
          >
            {content.alternateLinkLabel}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="relative flex w-full max-w-[clamp(31.5rem,37vw,44rem)] flex-col overflow-hidden rounded-[1.875rem] border border-white/[0.16] bg-[#0b151d]/94 p-6 shadow-[0_36px_100px_-42px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm sm:p-8 xl:h-full xl:min-h-0 xl:px-[clamp(2rem,3.65vw,3.75rem)] xl:pt-[clamp(1.65rem,4.6vh,2.75rem)] xl:pb-[clamp(0.75rem,1.7vh,1.125rem)]"
    >
      <div aria-hidden="true" className="absolute inset-x-12 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(37,229,129,0.48),transparent)]" />
      <div aria-hidden="true" className="absolute top-[-8rem] left-1/2 size-72 -translate-x-1/2 rounded-full bg-[#16cf6d]/10 blur-3xl" />

      <div className="-mx-1 min-h-0 flex-1 px-1 xl:overflow-y-auto xl:overscroll-contain xl:[scroll-padding-block:1rem] xl:[scrollbar-color:rgba(45,228,131,0.32)_transparent] xl:[scrollbar-width:thin]">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start">
          <span aria-hidden="true" />
          <div
            aria-hidden="true"
            className="relative mx-auto flex size-[clamp(3.5rem,8.6vh,5rem)] shrink-0 items-center justify-center"
          >
            <span className="absolute inset-0 [clip-path:polygon(50%_0%,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)] bg-[#19dc75]/20 shadow-[0_0_34px_rgba(25,220,117,0.25)]" />
            <span className="absolute inset-[2px] [clip-path:polygon(50%_0%,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)] bg-[#0b2017]" />
            <ShieldCheck aria-hidden="true" className="relative size-[clamp(1.5rem,3.25vh,1.875rem)] text-[#38ea8d]" strokeWidth={1.8} />
          </div>
          <Link
            aria-label="Back to home"
            className="z-20 inline-flex min-h-11 cursor-pointer items-center justify-self-end gap-1.5 rounded-full border border-[#2add81]/25 bg-[#10271c]/75 px-3 text-xs font-semibold text-slate-300 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.8)] transition-[color,background-color,border-color,transform] duration-200 motion-reduce:transform-none motion-reduce:transition-none hover:border-[#2add81]/50 hover:bg-[#153726] hover:text-[#5bf2a0] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2de483]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b151d]"
            href={siteConfig.routes.home}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            <span className="hidden min-[350px]:inline">Back home</span>
          </Link>
        </div>
        <h1
          className="mt-[clamp(0.75rem,1.8vh,1.125rem)] text-center text-[clamp(1.875rem,4.1vh,2.5rem)] leading-tight font-semibold tracking-[-0.04em] text-white"
          id={headingId}
        >
          {content.title}
        </h1>
        <p className="mx-auto mt-[clamp(0.5rem,1.25vh,0.75rem)] max-w-[25rem] text-center text-[clamp(0.9375rem,1.8vh,1rem)] leading-[1.55] text-slate-300">
          {content.description}
        </p>
        {hasSignInError ? (
          <p className="mt-[clamp(0.7rem,1.8vh,1.25rem)] rounded-xl border border-destructive/35 bg-destructive/15 px-3.5 py-2.5 text-sm leading-5 text-slate-100" role="alert">
            We couldn’t complete Google sign-in. Please try again.
          </p>
        ) : null}
        <AuthForm appearance={appearance} mode={mode} />
        <div className="mt-[clamp(0.75rem,1.55vh,1rem)] flex items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-white/[0.14]" />
          <span className="text-[0.8125rem] font-medium text-slate-400">or continue with</span>
          <span className="h-px flex-1 bg-white/[0.14]" />
        </div>
        <div className="mt-[clamp(0.75rem,1.45vh,0.875rem)]">
          <GoogleAuthButton appearance={appearance} label={content.googleActionLabel} />
        </div>
      </div>

      <p className="shrink-0 pt-[clamp(0.4rem,1.25vh,0.75rem)] text-center text-sm text-slate-400">
        {content.alternatePrompt}{" "}
        <Link
          className="inline-flex min-h-10 cursor-pointer items-center rounded-md px-1 font-semibold text-[#31e78a] underline-offset-4 transition-colors duration-200 motion-reduce:transition-none hover:text-[#6af5aa] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2de483]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b151d]"
          href={content.alternateHref}
        >
          {content.alternateLinkLabel}
        </Link>
      </p>
    </section>
  );
}
