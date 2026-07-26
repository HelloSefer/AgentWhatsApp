"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { siteConfig } from "@/config/site";
import { useRequestPasswordResetMutation } from "../hooks/use-auth-session";
import { authErrorMessage } from "../utils/auth-error-message";

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const formId = useId();
  const requestReset = useRequestPasswordResetMutation();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const isBusy = isSubmitting || requestReset.isPending;

  async function onSubmit(values: ForgotPasswordValues) {
    if (isBusy) return;
    setSuccessMessage(null);

    try {
      await requestReset.mutateAsync({ email: values.email });
      setSuccessMessage("If an account can receive password reset email, instructions will be sent. Please check your inbox.");
    } catch (error) {
      setError("root", { message: authErrorMessage(error) });
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)}>
      {errors.root?.message ? (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground" role="alert">
          {errors.root.message}
        </p>
      ) : null}
      {successMessage ? (
        <p className="rounded-lg border border-marketing-primary/25 bg-marketing-subtle px-3 py-2.5 text-sm leading-5 text-foreground" role="status">
          {successMessage}
        </p>
      ) : null}
      <div>
        <Label htmlFor={`${formId}-email`}>Email</Label>
        <Input
          aria-describedby={errors.email ? `${formId}-email-error` : undefined}
          aria-invalid={Boolean(errors.email)}
          autoComplete="email"
          className="mt-2 h-11"
          disabled={isBusy}
          id={`${formId}-email`}
          inputMode="email"
          type="email"
          {...register("email")}
        />
        {errors.email?.message ? (
          <p className="mt-2 text-sm leading-5 text-destructive" id={`${formId}-email-error`} role="alert">
            {errors.email.message}
          </p>
        ) : null}
      </div>
      <Button aria-busy={isBusy} className="h-11 w-full" disabled={isBusy} type="submit">
        {isBusy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {isBusy ? "Sending..." : "Send reset instructions"}
      </Button>
      <Link className={buttonVariants({ variant: "link", className: "h-auto w-full px-0" })} href={siteConfig.routes.login}>
        Back to login
      </Link>
    </form>
  );
}
