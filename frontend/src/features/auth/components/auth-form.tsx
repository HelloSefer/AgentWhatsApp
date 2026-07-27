"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useLoginMutation, useSignupMutation } from "../hooks/use-auth-session";
import { authErrorMessage } from "../utils/auth-error-message";
import { safeAuthRedirectFromRawSearch } from "../utils/safe-redirect";
import type { AuthAppearance, AuthScreenMode } from "../config/auth-screen-content";
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
  appearance?: AuthAppearance;
  mode: AuthScreenMode;
}>;

const rememberedEmailStorageKey = "agentwhatsapp:remembered-login-email";
const lightAuthInputClassName =
  "mt-2 h-11";
const darkAuthInputClassName =
  "h-[clamp(2.875rem,5.6vh,3.25rem)] cursor-text rounded-xl border-[#526479] bg-[#111c25] px-3.5 text-base text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-[border-color,background-color,box-shadow] duration-200 motion-reduce:transition-none placeholder:text-slate-400 hover:border-[#6b7e92] hover:bg-[#14212b] focus-visible:border-[#2de483] focus-visible:ring-2 focus-visible:ring-[#2de483]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b151d] disabled:cursor-not-allowed md:text-[0.9375rem]";
const lightAuthLabelClassName = "";
const darkAuthLabelClassName = "text-[clamp(0.8125rem,1.7vh,0.9375rem)] font-semibold text-slate-100";
const lightAuthSubmitClassName =
  "h-11 w-full";
const darkAuthSubmitClassName =
  "relative h-[clamp(3rem,6vh,3.5rem)] w-full cursor-pointer rounded-xl border border-[#38df88]/55 bg-[linear-gradient(90deg,#06783a,#0b8744)] text-sm font-semibold text-white shadow-[0_14px_34px_-16px_rgba(18,209,107,0.72)] transition-[transform,box-shadow,background-color] duration-200 motion-reduce:transform-none motion-reduce:transition-none hover:bg-[linear-gradient(90deg,#07823f,#0c9049)] hover:shadow-[0_18px_38px_-16px_rgba(18,209,107,0.84)] active:translate-y-px focus-visible:border-[#68f2aa] focus-visible:ring-2 focus-visible:ring-[#2de483]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b151d] disabled:cursor-not-allowed disabled:opacity-60";

function FieldError({
  appearance = "light",
  id,
  message,
}: Readonly<{ appearance?: AuthAppearance; id: string; message?: string }>) {
  if (!message) return null;
  return (
    <p
      className={appearance === "dark" ? "mt-1.5 text-xs leading-5 text-red-300" : "mt-2 text-sm leading-5 text-destructive"}
      id={id}
      role="alert"
    >
      {message}
    </p>
  );
}

function PasswordInput({
  appearance,
  autoComplete,
  describedBy,
  disabled,
  error,
  id,
  placeholder,
  registration,
}: Readonly<{
  appearance: AuthAppearance;
  autoComplete: "current-password" | "new-password";
  describedBy?: string;
  disabled: boolean;
  error?: boolean;
  id: string;
  placeholder?: string;
  registration: UseFormRegisterReturn;
}>) {
  const [isVisible, setIsVisible] = useState(false);
  const isDark = appearance === "dark";

  return (
    <div className={cn("relative", isDark && "mt-[clamp(0.375rem,0.75vh,0.5rem)]")}>
      {isDark ? (
        <LockKeyhole
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3.5 z-10 my-auto size-4 text-slate-400"
        />
      ) : null}
      <Input
        aria-describedby={describedBy}
        aria-invalid={error}
        aria-required="true"
        autoComplete={autoComplete}
        className={cn(isDark ? darkAuthInputClassName : "h-11 pr-11", isDark && "pr-12 pl-11")}
        disabled={disabled}
        id={id}
        placeholder={placeholder}
        required
        suppressHydrationWarning={isDark}
        type={isVisible ? "text" : "password"}
        {...registration}
      />
      <Button
        aria-controls={id}
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        className={cn(
          isDark
            ? "absolute inset-y-0 right-0.5 my-auto size-11 cursor-pointer rounded-lg text-slate-400 transition-colors duration-200 motion-reduce:transition-none hover:bg-white/[0.08] hover:text-slate-100 active:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-[#2de483]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111c25] disabled:cursor-not-allowed"
            : "absolute top-1.5 right-1.5",
        )}
        disabled={disabled}
        onClick={() => setIsVisible((value) => !value)}
        size="icon"
        suppressHydrationWarning={isDark}
        type="button"
        variant="ghost"
      >
        {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}

export function AuthForm({ appearance = "light", mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const formId = useId();
  const redirectTo = useMemo(() => {
    searchParams.toString();
    return safeAuthRedirectFromRawSearch(typeof window === "undefined" ? "" : window.location.search);
  }, [searchParams]);

  if (mode === "login") {
    return (
      <LoginForm
        appearance={appearance}
        formId={formId}
        redirectTo={redirectTo}
        setSuccessMessage={setSuccessMessage}
        successMessage={successMessage}
        routerReplace={(href) => router.replace(href)}
      />
    );
  }

  return <SignupForm formId={formId} setSuccessMessage={setSuccessMessage} successMessage={successMessage} />;
}

function LoginForm({
  appearance,
  formId,
  redirectTo,
  routerReplace,
  setSuccessMessage,
  successMessage,
}: Readonly<{
  appearance: AuthAppearance;
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
    setValue,
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const [rememberMe, setRememberMe] = useState(true);
  const rootErrorRef = useRef<HTMLParagraphElement>(null);
  const isBusy = isSubmitting || login.isPending;
  const formErrorId = `${formId}-form-error`;
  const emailErrorId = `${formId}-email-error`;
  const passwordErrorId = `${formId}-password-error`;
  const isDark = appearance === "dark";
  const inputClassName = isDark ? darkAuthInputClassName : lightAuthInputClassName;
  const labelClassName = isDark ? darkAuthLabelClassName : lightAuthLabelClassName;
  const submitClassName = isDark ? darkAuthSubmitClassName : lightAuthSubmitClassName;

  useEffect(() => {
    try {
      const rememberedEmail = window.localStorage.getItem(rememberedEmailStorageKey);
      if (rememberedEmail) setValue("email", rememberedEmail);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, [setValue]);

  useEffect(() => {
    if (errors.root?.message) rootErrorRef.current?.focus();
  }, [errors.root?.message]);

  async function onSubmit(values: LoginValues) {
    if (isBusy) return;
    setSuccessMessage(null);
    try {
      await login.mutateAsync(values);
      try {
        if (rememberMe) {
          window.localStorage.setItem(rememberedEmailStorageKey, values.email);
        } else {
          window.localStorage.removeItem(rememberedEmailStorageKey);
        }
      } catch {
        // A successful login must never depend on optional local storage.
      }
      setSuccessMessage("Signed in. Taking you to your workspace.");
      routerReplace(redirectTo);
    } catch (error) {
      setError("root", { message: authErrorMessage(error) });
    }
  }

  return (
    <form
      aria-busy={isBusy}
      aria-describedby={errors.root?.message ? formErrorId : undefined}
      className={isDark ? "mt-[clamp(0.75rem,1.5vh,1rem)] space-y-[clamp(0.75rem,1.6vh,1rem)]" : "mt-8 space-y-5"}
      noValidate
      onSubmit={handleSubmit(onSubmit)}
    >
      {errors.root?.message ? (
        <p
          className={cn(
            isDark
              ? "rounded-xl border border-destructive/35 bg-destructive/15 px-3.5 py-2.5 text-sm leading-5 text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-red-300/70"
              : "rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground",
          )}
          id={formErrorId}
          ref={rootErrorRef}
          role="alert"
          tabIndex={-1}
        >
          {errors.root.message}
        </p>
      ) : null}
      {successMessage ? (
        <p
          className={cn(
            isDark
              ? "rounded-xl border border-[#2de483]/30 bg-[#0a2417] px-3.5 py-2.5 text-sm leading-5 text-slate-100"
              : "rounded-lg border border-marketing-primary/25 bg-marketing-subtle px-3 py-2.5 text-sm leading-5 text-foreground",
          )}
          role="status"
        >
          {successMessage}
        </p>
      ) : null}
      <div>
        <Label className={labelClassName} htmlFor={`${formId}-email`}>Email address</Label>
        <div className={cn("relative", isDark && "mt-[clamp(0.375rem,0.75vh,0.5rem)]")}>
          {isDark ? (
            <Mail
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3.5 z-10 my-auto size-4 text-slate-400"
            />
          ) : null}
          <Input
            aria-describedby={errors.email ? emailErrorId : undefined}
            aria-invalid={Boolean(errors.email)}
            aria-required="true"
            autoComplete="email"
            className={cn(inputClassName, isDark && "pl-11")}
            disabled={isBusy}
            id={`${formId}-email`}
            inputMode="email"
            placeholder={isDark ? "you@example.com" : undefined}
            required
            suppressHydrationWarning={isDark}
            type="email"
            {...register("email")}
          />
        </div>
        <FieldError appearance={appearance} id={emailErrorId} message={errors.email?.message} />
      </div>
      <div>
        <Label className={labelClassName} htmlFor={`${formId}-password`}>Password</Label>
        <PasswordInput
          appearance={appearance}
          autoComplete="current-password"
          describedBy={errors.password ? passwordErrorId : undefined}
          disabled={isBusy}
          error={Boolean(errors.password)}
          id={`${formId}-password`}
          placeholder={isDark ? "Enter your password" : undefined}
          registration={register("password")}
        />
        <FieldError appearance={appearance} id={passwordErrorId} message={errors.password?.message} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <label
          aria-disabled={isBusy}
          className={cn(
            "relative inline-flex items-center gap-2 text-sm transition-colors duration-200 motion-reduce:transition-none after:absolute after:-inset-x-2 after:-inset-y-3",
            isBusy ? "cursor-not-allowed opacity-65" : "cursor-pointer",
            isDark ? (!isBusy && "text-slate-300 hover:text-slate-100") : "text-muted-foreground",
          )}
          htmlFor={`${formId}-remember-me`}
        >
          <input
            aria-describedby={`${formId}-remember-me-description`}
            checked={rememberMe}
            className="size-4 cursor-pointer rounded border-white/30 accent-[#18cc6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2de483]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b151d] disabled:cursor-not-allowed"
            disabled={isBusy}
            id={`${formId}-remember-me`}
            name="rememberMe"
            onChange={(event) => setRememberMe(event.target.checked)}
            suppressHydrationWarning={isDark}
            type="checkbox"
          />
          Remember me
        </label>
        <span className="sr-only" id={`${formId}-remember-me-description`}>
          Stores only your email address on this device for the next sign-in.
        </span>
        <Link
          className={buttonVariants({
            variant: "link",
            className: cn(
              "h-auto cursor-pointer px-0 py-0 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none",
              isDark
                ? "relative text-[#31e78a] after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-[#6af5aa] focus-visible:ring-2 focus-visible:ring-[#2de483]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b151d]"
                : "text-marketing-primary",
            ),
          })}
          href="/forgot-password"
        >
          Forgot password?
        </Link>
      </div>
      <Button
        aria-busy={isBusy}
        className={submitClassName}
        disabled={isBusy}
        suppressHydrationWarning={isDark}
        type="submit"
      >
        {isBusy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
        {isBusy ? "Signing in..." : "Sign in"}
        {!isBusy && isDark ? (
          <ArrowRight
            aria-hidden="true"
            className="absolute right-4 transition-transform duration-200 motion-reduce:transform-none motion-reduce:transition-none group-hover/button:translate-x-0.5"
          />
        ) : null}
      </Button>
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
    <>
      <form className="mt-8 space-y-5" noValidate onSubmit={handleSubmit(onSubmit)}>
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
                className={lightAuthInputClassName}
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
            appearance="light"
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
        <Button aria-busy={isBusy} className={lightAuthSubmitClassName} disabled={isBusy} type="submit">
          {isBusy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {isBusy ? "Creating account..." : "Create account"}
        </Button>
      </form>
      {createdEmail ? <EmailVerificationRequestForm defaultEmail={createdEmail} /> : null}
    </>
  );
}
