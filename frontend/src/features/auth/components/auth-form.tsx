"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLoginMutation, useSignupMutation } from "../hooks/use-auth-session";
import { authErrorMessage } from "../utils/auth-error-message";
import { safeAuthRedirectFromRawSearch } from "../utils/safe-redirect";
import type { AuthScreenMode } from "../config/auth-screen-content";
import { EmailVerificationRequestForm } from "./email-verification-request-form";

const emailSchema = z.string().trim().email("Enter a valid email address.");
const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(256, "Use 256 characters or fewer.")
  .regex(/[a-z]/u, "Use at least one lowercase letter.")
  .regex(/[A-Z]/u, "Use at least one uppercase letter.")
  .regex(/[0-9]/u, "Use at least one number.")
  .regex(/[^A-Za-z0-9]/u, "Use at least one symbol.")
  .refine((value) => !/\s/u.test(value), "Do not use spaces.");

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(256, "Use 256 characters or fewer."),
});

const signupSchema = z
  .object({
    displayName: z.string().trim().min(2, "Enter your display name.").max(80, "Use 80 characters or fewer."),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type LoginValues = z.infer<typeof loginSchema>;
type SignupValues = z.infer<typeof signupSchema>;

type AuthFormProps = Readonly<{
  mode: AuthScreenMode;
}>;

function FieldError({ id, message }: Readonly<{ id: string; message?: string }>) {
  if (!message) return null;
  return (
    <p className="mt-2 text-sm leading-5 text-destructive" id={id} role="alert">
      {message}
    </p>
  );
}

function PasswordInput({
  autoComplete,
  describedBy,
  disabled,
  error,
  id,
  registration,
}: Readonly<{
  autoComplete: "current-password" | "new-password";
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
        autoComplete={autoComplete}
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

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const formId = useId();
  const redirectTo = useMemo(() => {
    searchParams.toString();
    return safeAuthRedirectFromRawSearch(typeof window === "undefined" ? "" : window.location.search);
  }, [searchParams]);

  if (mode === "login") {
    return <LoginForm formId={formId} redirectTo={redirectTo} setSuccessMessage={setSuccessMessage} successMessage={successMessage} routerReplace={(href) => router.replace(href)} />;
  }

  return <SignupForm formId={formId} setSuccessMessage={setSuccessMessage} successMessage={successMessage} />;
}

function LoginForm({
  formId,
  redirectTo,
  routerReplace,
  setSuccessMessage,
  successMessage,
}: Readonly<{
  formId: string;
  redirectTo: string;
  routerReplace: (href: string) => void;
  setSuccessMessage: (message: string | null) => void;
  successMessage: string | null;
}>) {
  const login = useLoginMutation();
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const isBusy = isSubmitting || login.isPending;
  const formErrorId = `${formId}-form-error`;
  const emailErrorId = `${formId}-email-error`;
  const passwordErrorId = `${formId}-password-error`;

  async function onSubmit(values: LoginValues) {
    if (isBusy) return;
    setSuccessMessage(null);
    try {
      await login.mutateAsync(values);
      setSuccessMessage("Signed in. Taking you to your workspace.");
      routerReplace(redirectTo);
    } catch (error) {
      setError("root", { message: authErrorMessage(error) });
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)}>
      {errors.root?.message ? (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground" id={formErrorId} role="alert">
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
          aria-describedby={errors.email ? emailErrorId : undefined}
          aria-invalid={Boolean(errors.email)}
          autoComplete="email"
          className="mt-2 h-11"
          disabled={isBusy}
          id={`${formId}-email`}
          inputMode="email"
          type="email"
          {...register("email")}
        />
        <FieldError id={emailErrorId} message={errors.email?.message} />
      </div>
      <div>
        <Label htmlFor={`${formId}-password`}>Password</Label>
        <PasswordInput
          autoComplete="current-password"
          describedBy={errors.password ? passwordErrorId : undefined}
          disabled={isBusy}
          error={Boolean(errors.password)}
          id={`${formId}-password`}
          registration={register("password")}
        />
        <FieldError id={passwordErrorId} message={errors.password?.message} />
      </div>
      <Button aria-busy={isBusy} className="h-11 w-full" disabled={isBusy} type="submit">
        {isBusy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {isBusy ? "Signing in..." : "Log in"}
      </Button>
      <Link className={buttonVariants({ variant: "link", className: "h-auto w-full px-0" })} href="/forgot-password">
        Forgot password?
      </Link>
    </form>
  );
}

function SignupForm({
  formId,
  setSuccessMessage,
  successMessage,
}: Readonly<{
  formId: string;
  setSuccessMessage: (message: string | null) => void;
  successMessage: string | null;
}>) {
  const signup = useSignupMutation();
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: "", email: "", password: "", confirmPassword: "" },
  });
  const isBusy = isSubmitting || signup.isPending;
  const formErrorId = `${formId}-form-error`;
  const passwordHelpId = `${formId}-password-help`;

  async function onSubmit(values: SignupValues) {
    if (isBusy) return;
    setSuccessMessage(null);
    try {
      await signup.mutateAsync({
        displayName: values.displayName,
        email: values.email,
        password: values.password,
      });
      setCreatedEmail(values.email);
      setSuccessMessage("Account created. Please verify your email. You can request a verification email below if email delivery is configured.");
    } catch (error) {
      setError("root", { message: authErrorMessage(error) });
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)}>
      {errors.root?.message ? (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground" id={formErrorId} role="alert">
          {errors.root.message}
        </p>
      ) : null}
      {successMessage ? (
        <div className="rounded-lg border border-marketing-primary/25 bg-marketing-subtle px-3 py-2.5 text-sm leading-5 text-foreground" role="status">
          <p>{successMessage}</p>
          <Link className={buttonVariants({ variant: "link", className: "mt-2 h-auto px-0 text-marketing-primary" })} href="/dashboard">
            Continue to dashboard
          </Link>
        </div>
      ) : null}
      {createdEmail ? <EmailVerificationRequestForm defaultEmail={createdEmail} /> : null}
      {[
        ["displayName", "Display name", "text", "name"],
        ["email", "Email", "email", "email"],
      ].map(([name, label, type, autoComplete]) => {
        const error = errors[name as "displayName" | "email"];
        const errorId = `${formId}-${name}-error`;
        return (
          <div key={name}>
            <Label htmlFor={`${formId}-${name}`}>{label}</Label>
            <Input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={Boolean(error)}
              autoComplete={autoComplete}
              className="mt-2 h-11"
              disabled={isBusy}
              id={`${formId}-${name}`}
              inputMode={name === "email" ? "email" : undefined}
              type={type}
              {...register(name as "displayName" | "email")}
            />
            <FieldError id={errorId} message={error?.message} />
          </div>
        );
      })}
      <div>
        <Label htmlFor={`${formId}-password`}>Password</Label>
        <PasswordInput
          autoComplete="new-password"
          describedBy={[passwordHelpId, errors.password ? `${formId}-password-error` : undefined].filter(Boolean).join(" ")}
          disabled={isBusy}
          error={Boolean(errors.password)}
          id={`${formId}-password`}
          registration={register("password")}
        />
        <p className="mt-2 text-xs leading-5 text-muted-foreground" id={passwordHelpId}>
          Use 12+ characters with uppercase, lowercase, number, symbol, and no spaces.
        </p>
        <FieldError id={`${formId}-password-error`} message={errors.password?.message} />
      </div>
      <div>
        <Label htmlFor={`${formId}-confirm-password`}>Confirm password</Label>
        <Input
          aria-describedby={errors.confirmPassword ? `${formId}-confirm-password-error` : undefined}
          aria-invalid={Boolean(errors.confirmPassword)}
          autoComplete="new-password"
          className="mt-2 h-11"
          disabled={isBusy}
          id={`${formId}-confirm-password`}
          type="password"
          {...register("confirmPassword")}
        />
        <FieldError id={`${formId}-confirm-password-error`} message={errors.confirmPassword?.message} />
      </div>
      <Button aria-busy={isBusy} className="h-11 w-full" disabled={isBusy} type="submit">
        {isBusy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {isBusy ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
