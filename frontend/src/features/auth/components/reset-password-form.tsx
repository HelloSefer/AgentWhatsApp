"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { siteConfig } from "@/config/site";
import { useResetPasswordMutation } from "../hooks/use-auth-session";
import { authErrorMessage } from "../utils/auth-error-message";

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(256, "Use 256 characters or fewer.")
      .regex(/[a-z]/u, "Use at least one lowercase letter.")
      .regex(/[A-Z]/u, "Use at least one uppercase letter.")
      .regex(/[0-9]/u, "Use at least one number.")
      .regex(/[^A-Za-z0-9]/u, "Use at least one symbol.")
      .refine((value) => !/\s/u.test(value), "Do not use spaces."),
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

type ResetPasswordFormProps = Readonly<{
  token: string | null;
}>;

function PasswordField({
  describedBy,
  disabled,
  error,
  id,
  registration,
}: Readonly<{
  describedBy?: string;
  disabled: boolean;
  error?: boolean;
  id: string;
  registration: UseFormRegisterReturn;
}>) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        aria-describedby={describedBy}
        aria-invalid={error}
        autoComplete="new-password"
        className="h-11 pr-11"
        disabled={disabled}
        id={id}
        type={isVisible ? "text" : "password"}
        {...registration}
      />
      <Button
        aria-label={isVisible ? "Hide password" : "Show password"}
        className="absolute top-1.5 right-1.5"
        disabled={disabled}
        onClick={() => setIsVisible((value) => !value)}
        size="icon"
        type="button"
        variant="ghost"
      >
        {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const formId = useId();
  const resetPassword = useResetPasswordMutation();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const isBusy = isSubmitting || resetPassword.isPending;
  const passwordHelpId = `${formId}-password-help`;

  async function onSubmit(values: ResetPasswordValues) {
    if (isBusy || !token) return;
    setSuccessMessage(null);

    try {
      await resetPassword.mutateAsync({ token, newPassword: values.password });
      setSuccessMessage("Your password has been reset. Please log in with your new password.");
    } catch (error) {
      setError("root", { message: authErrorMessage(error) });
    }
  }

  if (!token) {
    return (
      <div className="mt-8 space-y-5">
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground" role="alert">
          This reset link is missing a token. Request a new password reset email.
        </p>
        <Link className={buttonVariants({ className: "h-11 w-full" })} href="/forgot-password">
          Request a new reset link
        </Link>
      </div>
    );
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
        <Label htmlFor={`${formId}-password`}>New password</Label>
        <PasswordField
          describedBy={[passwordHelpId, errors.password ? `${formId}-password-error` : undefined].filter(Boolean).join(" ")}
          disabled={isBusy || resetPassword.isSuccess}
          error={Boolean(errors.password)}
          id={`${formId}-password`}
          registration={register("password")}
        />
        <p className="mt-2 text-xs leading-5 text-muted-foreground" id={passwordHelpId}>
          Use 12+ characters with uppercase, lowercase, number, symbol, and no spaces.
        </p>
        {errors.password?.message ? (
          <p className="mt-2 text-sm leading-5 text-destructive" id={`${formId}-password-error`} role="alert">
            {errors.password.message}
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor={`${formId}-confirm-password`}>Confirm new password</Label>
        <Input
          aria-describedby={errors.confirmPassword ? `${formId}-confirm-password-error` : undefined}
          aria-invalid={Boolean(errors.confirmPassword)}
          autoComplete="new-password"
          className="mt-2 h-11"
          disabled={isBusy || resetPassword.isSuccess}
          id={`${formId}-confirm-password`}
          type="password"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword?.message ? (
          <p className="mt-2 text-sm leading-5 text-destructive" id={`${formId}-confirm-password-error`} role="alert">
            {errors.confirmPassword.message}
          </p>
        ) : null}
      </div>
      <Button aria-busy={isBusy} className="h-11 w-full" disabled={isBusy || resetPassword.isSuccess} type="submit">
        {isBusy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {isBusy ? "Resetting..." : "Reset password"}
      </Button>
      <Link className={buttonVariants({ variant: "link", className: "h-auto w-full px-0" })} href={siteConfig.routes.login}>
        Back to login
      </Link>
    </form>
  );
}
