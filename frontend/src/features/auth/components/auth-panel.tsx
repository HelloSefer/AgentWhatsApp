import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import type { AuthScreenContent, AuthScreenMode } from "../config/auth-screen-content";
import { GoogleAuthButton } from "./google-auth-button";

type AuthPanelProps = Readonly<{
  mode: AuthScreenMode;
  content: AuthScreenContent;
  hasSignInError: boolean;
}>;

export function AuthPanel({ mode, content, hasSignInError }: AuthPanelProps) {
  const headingId = `${mode}-heading`;

  return (
    <section aria-labelledby={headingId} className="w-full max-w-[33.75rem] rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_24px_48px_-36px_oklch(0.2_0.04_155/0.45)] sm:p-8 lg:p-10">
      <p className="text-xs font-semibold tracking-[0.11em] text-marketing-primary uppercase">{content.eyebrow}</p>
      <h1 className="mt-4 text-3xl leading-[1.12] font-semibold tracking-[-0.04em] text-foreground sm:text-[2.5rem]" id={headingId}>
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
      <p className="mt-6 flex gap-2.5 text-xs leading-5 text-muted-foreground">
        <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-marketing-primary" />
        Google handles authentication securely. AgentWhatsApp never receives your Google password.
      </p>
      <p className="mt-8 border-t border-marketing-border pt-6 text-sm text-muted-foreground">
        {content.alternatePrompt}{" "}
        <Link className="font-semibold text-marketing-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={content.alternateHref}>
          {content.alternateLinkLabel}
        </Link>
      </p>
    </section>
  );
}
