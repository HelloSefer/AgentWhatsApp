"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequestEmailVerificationMutation } from "../hooks/use-auth-session";
import { authErrorMessage } from "../utils/auth-error-message";

const emailVerificationRequestSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

type EmailVerificationRequestValues = z.infer<typeof emailVerificationRequestSchema>;

type EmailVerificationRequestFormProps = Readonly<{
  defaultEmail?: string;
}>;

export function EmailVerificationRequestForm({ defaultEmail = "" }: EmailVerificationRequestFormProps) {
  const formId = useId();
  const requestVerification = useRequestEmailVerificationMutation();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<EmailVerificationRequestValues>({
    resolver: zodResolver(emailVerificationRequestSchema),
    defaultValues: { email: defaultEmail },
  });
  const isBusy = isSubmitting || requestVerification.isPending;

  async function onSubmit(values: EmailVerificationRequestValues) {
    if (isBusy) return;
    setSuccessMessage(null);

    try {
      await requestVerification.mutateAsync({ email: values.email });
      setSuccessMessage("If verification is available for this address, instructions will be sent. Please check your email.");
    } catch (error) {
      setError("root", { message: authErrorMessage(error) });
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
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
        {isBusy ? "Requesting..." : "Send verification email"}
      </Button>
    </form>
  );
}
