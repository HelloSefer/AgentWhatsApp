"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { useConfirmEmailVerificationMutation } from "../hooks/use-auth-session";
import { authErrorMessage } from "../utils/auth-error-message";
import { EmailVerificationRequestForm } from "./email-verification-request-form";

type VerifyEmailPanelProps = Readonly<{
  token: string | null;
}>;

export function VerifyEmailPanel({ token }: VerifyEmailPanelProps) {
  const confirmVerification = useConfirmEmailVerificationMutation();

  useEffect(() => {
    if (!token || confirmVerification.isPending || confirmVerification.isSuccess || confirmVerification.isError) return;
    confirmVerification.mutate({ token });
  }, [confirmVerification, token]);

  const status = !token
    ? "missing"
    : confirmVerification.isSuccess
      ? "success"
      : confirmVerification.isError
        ? "invalid"
        : "loading";

  return (
    <section aria-labelledby="verify-email-heading" className="w-full max-w-[33.75rem] rounded-2xl border border-marketing-border bg-marketing-surface p-6 shadow-[0_24px_48px_-36px_oklch(0.2_0.04_155/0.45)] sm:p-8 lg:p-10">
      <p className="text-xs font-semibold tracking-[0.11em] text-marketing-primary uppercase">Email verification</p>
      <h1 className="mt-4 text-3xl leading-[1.12] font-semibold tracking-[-0.04em] text-foreground sm:text-[2.5rem]" id="verify-email-heading">
        Verify your email
      </h1>
      <div className="mt-6">
        {status === "loading" ? (
          <p className="flex items-center gap-2 rounded-lg border border-marketing-border bg-marketing-canvas px-3 py-2.5 text-sm leading-5 text-foreground" role="status">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Checking your verification link...
          </p>
        ) : null}
        {status === "success" ? (
          <p className="rounded-lg border border-marketing-primary/25 bg-marketing-subtle px-3 py-2.5 text-sm leading-5 text-foreground" role="status">
            Your email has been verified. You can now log in.
          </p>
        ) : null}
        {status === "missing" ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground" role="alert">
            This verification link is missing a token. Request a new verification email below.
          </p>
        ) : null}
        {status === "invalid" ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground" role="alert">
            {authErrorMessage(confirmVerification.error)}
          </p>
        ) : null}
      </div>
      <div className="mt-8">
        <Link className={buttonVariants({ className: "h-11 w-full" })} href={siteConfig.routes.login}>
          Back to login
        </Link>
      </div>
      <div className="mt-8 border-t border-marketing-border pt-6">
        <h2 className="text-base font-semibold text-foreground">Request a new verification email</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We will show the same response either way, so account existence stays private.
        </p>
        <EmailVerificationRequestForm />
      </div>
    </section>
  );
}
