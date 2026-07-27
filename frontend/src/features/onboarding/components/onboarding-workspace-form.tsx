"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ImagePlus, Loader2, Trash2, UploadCloud, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { authQueryKeys, useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { onboardingQueryKeys, useCreateWorkspaceMutation, useOnboardingStatus, useUploadLogoMutation } from "../hooks/use-onboarding";
import { onboardingErrorMessage } from "../utils/onboarding-error-message";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const onboardingSchema = z.object({
  storeName: z
    .string()
    .trim()
    .min(2, "Enter your store name.")
    .max(120, "Use 120 characters or fewer."),
  intendedWhatsAppPhone: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^\+[1-9][0-9\s().-]{1,18}$/u.test(value), "Use an international number such as +212600000000."),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

type SelectedLogo = Readonly<{
  file: File;
  previewUrl: string;
}>;

function FieldError({ id, message }: Readonly<{ id: string; message?: string }>) {
  if (!message) return null;
  return (
    <p className="mt-2 text-sm leading-5 text-destructive" id={id} role="alert">
      {message}
    </p>
  );
}

function validateLogoFile(file: File): string | null {
  if (!LOGO_MIME_TYPES.has(file.type)) return "Use a PNG, JPEG, or WebP image.";
  if (file.size > MAX_LOGO_BYTES) return "Logo must be 2 MB or smaller.";
  return null;
}

export function OnboardingWorkspaceForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootErrorRef = useRef<HTMLParagraphElement>(null);
  const auth = useAuthSession();
  const statusQuery = useOnboardingStatus(auth.isAuthenticated);
  const createWorkspace = useCreateWorkspaceMutation();
  const uploadLogo = useUploadLogoMutation();
  const [selectedLogo, setSelectedLogo] = useState<SelectedLogo | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [createdWorkspaceConfirmed, setCreatedWorkspaceConfirmed] = useState(false);

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { storeName: "", intendedWhatsAppPhone: "" },
  });

  const isBusy = isSubmitting || createWorkspace.isPending || uploadLogo.isPending;
  const canRecoverFromLogoError = createdWorkspaceConfirmed && Boolean(selectedLogo) && Boolean(logoError);
  const storeNameErrorId = `${formId}-store-name-error`;
  const phoneErrorId = `${formId}-phone-error`;
  const rootErrorId = `${formId}-root-error`;
  const logoHelpId = `${formId}-logo-help`;
  const logoErrorId = `${formId}-logo-error`;
  const previewAlt = useMemo(() => selectedLogo ? `Preview of ${selectedLogo.file.name}` : "", [selectedLogo]);

  useEffect(() => {
    return () => {
      if (selectedLogo) URL.revokeObjectURL(selectedLogo.previewUrl);
    };
  }, [selectedLogo]);

  useEffect(() => {
    if (errors.root?.message) rootErrorRef.current?.focus();
  }, [errors.root?.message]);

  function replaceSelectedLogo(file: File | null) {
    setLogoError(null);
    setSelectedLogo((previous) => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
    if (!file) return;
    const error = validateLogoFile(file);
    if (error) {
      setLogoError(error);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSelectedLogo({ file, previewUrl: URL.createObjectURL(file) });
  }

  function removeSelectedLogo() {
    replaceSelectedLogo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function finishAndRedirect() {
    await Promise.all([
      statusQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: authQueryKeys.session }),
      queryClient.invalidateQueries({ queryKey: onboardingQueryKeys.status }),
    ]);
    router.replace("/dashboard");
  }

  async function uploadSelectedLogoOrThrow() {
    if (!selectedLogo) return;
    await uploadLogo.mutateAsync(selectedLogo.file);
  }

  async function onSubmit(values: OnboardingValues) {
    if (isBusy) return;
    setLogoError(null);
    setCreatedWorkspaceConfirmed(false);

    try {
      await createWorkspace.mutateAsync({
        storeName: values.storeName,
        intendedWhatsAppPhone: values.intendedWhatsAppPhone || undefined,
      });
      setCreatedWorkspaceConfirmed(true);
    } catch (error) {
      setError("root", { message: onboardingErrorMessage(error) });
      return;
    }

    try {
      await uploadSelectedLogoOrThrow();
      toast.success("Workspace created.");
      await finishAndRedirect();
    } catch (error) {
      const message = onboardingErrorMessage(error);
      setLogoError(`${message} Your workspace was created, and you can retry the logo or continue without it.`);
      toast.error("Workspace created, but the logo was not uploaded.");
    }
  }

  async function retryLogoUpload() {
    if (!selectedLogo || uploadLogo.isPending) return;
    setLogoError(null);
    try {
      await uploadSelectedLogoOrThrow();
      toast.success("Logo uploaded.");
      await finishAndRedirect();
    } catch (error) {
      setLogoError(`${onboardingErrorMessage(error)} You can retry or continue without a logo.`);
    }
  }

  return (
    <section className="mx-auto mt-8 grid max-w-5xl gap-5 lg:mt-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start" aria-labelledby="onboarding-heading">
      <div className="rounded-2xl border border-marketing-border bg-marketing-surface p-5 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:p-7">
        <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Set up your workspace</p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground sm:text-4xl" id="onboarding-heading">
          Tell us about your store
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
          Create the seller workspace your team will use. WhatsApp connection comes later.
        </p>
        <div className="mt-6 grid gap-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-marketing-primary" />
            <p>Store identity is saved first, then optional logo upload runs separately.</p>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-marketing-primary" />
            <p>WhatsApp Business number is kept as unverified setup metadata.</p>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-marketing-primary" />
            <p>WhatsApp status: <span className="font-semibold text-foreground">Connect later</span>.</p>
          </div>
        </div>
      </div>

      <form
        aria-busy={isBusy}
        aria-describedby={errors.root?.message ? rootErrorId : undefined}
        className="rounded-2xl border border-marketing-border bg-marketing-surface p-5 shadow-[0_18px_36px_-30px_oklch(0.2_0.04_155/0.4)] sm:p-7"
        noValidate
        onSubmit={handleSubmit(onSubmit)}
      >
        {errors.root?.message ? (
          <p
            className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            id={rootErrorId}
            ref={rootErrorRef}
            role="alert"
            tabIndex={-1}
          >
            {errors.root.message}
          </p>
        ) : null}

        <div className="space-y-5">
          <div>
            <Label htmlFor={`${formId}-store-name`}>Store name</Label>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground" id={`${formId}-store-name-help`}>
              Use the public name customers recognize. Arabic, French, and Unicode names are welcome.
            </p>
            <Input
              aria-describedby={`${formId}-store-name-help ${errors.storeName ? storeNameErrorId : ""}`.trim()}
              aria-invalid={Boolean(errors.storeName)}
              autoComplete="organization"
              className="mt-2 min-h-11"
              disabled={isBusy || createdWorkspaceConfirmed}
              id={`${formId}-store-name`}
              required
              type="text"
              {...register("storeName")}
            />
            <FieldError id={storeNameErrorId} message={errors.storeName?.message} />
          </div>

          <div>
            <Label htmlFor={`${formId}-phone`}>Intended WhatsApp Business number</Label>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground" id={`${formId}-phone-help`}>
              Optional. Use E.164 format such as +212600000000. This does not connect, verify, or activate WhatsApp.
            </p>
            <Input
              aria-describedby={`${formId}-phone-help ${errors.intendedWhatsAppPhone ? phoneErrorId : ""}`.trim()}
              aria-invalid={Boolean(errors.intendedWhatsAppPhone)}
              autoComplete="tel"
              className="mt-2 min-h-11"
              disabled={isBusy || createdWorkspaceConfirmed}
              id={`${formId}-phone`}
              inputMode="tel"
              placeholder="+212600000000"
              type="tel"
              {...register("intendedWhatsAppPhone")}
            />
            <FieldError id={phoneErrorId} message={errors.intendedWhatsAppPhone?.message} />
          </div>

          <div>
            <Label htmlFor={`${formId}-logo`}>Store logo</Label>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground" id={logoHelpId}>
              Optional PNG, JPEG, or WebP. Maximum 2 MB. Upload happens through AgentWhatsApp after workspace creation.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-start">
              <div className="flex aspect-square min-h-28 items-center justify-center overflow-hidden rounded-xl border border-dashed border-marketing-border bg-marketing-canvas">
                {selectedLogo ? (
                  <Image
                    alt={previewAlt}
                    className="h-full w-full object-cover"
                    height={112}
                    src={selectedLogo.previewUrl}
                    unoptimized
                    width={112}
                  />
                ) : (
                  <ImagePlus aria-hidden="true" className="size-8 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 space-y-3">
                <Input
                  accept="image/png,image/jpeg,image/webp"
                  aria-describedby={`${logoHelpId} ${logoError ? logoErrorId : ""}`.trim()}
                  aria-invalid={Boolean(logoError)}
                  className="min-h-11 cursor-pointer file:mr-3 file:cursor-pointer"
                  disabled={isBusy}
                  id={`${formId}-logo`}
                  onChange={(event) => replaceSelectedLogo(event.target.files?.[0] ?? null)}
                  ref={fileInputRef}
                  type="file"
                />
                {selectedLogo ? (
                  <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 truncate">{selectedLogo.file.name}</span>
                    <Button className="min-h-11 w-full sm:w-auto" disabled={isBusy} onClick={removeSelectedLogo} type="button" variant="outline">
                      <Trash2 aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                ) : null}
                {logoError ? (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-5 text-foreground" id={logoErrorId} role="alert">
                    {logoError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className={cn("mt-7 flex flex-col gap-3", canRecoverFromLogoError ? "sm:flex-row" : "")}>
          {canRecoverFromLogoError ? (
            <>
              <Button className="min-h-11 flex-1" disabled={isBusy} onClick={retryLogoUpload} type="button">
                {uploadLogo.isPending ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <UploadCloud aria-hidden="true" />}
                Retry logo upload
              </Button>
              <Button className="min-h-11 flex-1" disabled={isBusy} onClick={finishAndRedirect} type="button" variant="outline">
                Continue without logo
                <ArrowRight aria-hidden="true" />
              </Button>
            </>
          ) : (
            <Button aria-busy={isBusy} className="min-h-11 w-full" disabled={isBusy} type="submit">
              {isBusy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
              {isBusy ? "Setting up..." : "Create workspace"}
              {!isBusy ? <ArrowRight aria-hidden="true" /> : null}
            </Button>
          )}
          {selectedLogo && !canRecoverFromLogoError ? (
            <Button className="min-h-11 w-full" disabled={isBusy} onClick={removeSelectedLogo} type="button" variant="ghost">
              <X aria-hidden="true" />
              Continue without selected logo
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
