"use client";

import {
  AlertCircle,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Info,
  Loader2,
  MapPin,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Save,
  Store,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuthSession } from "@/features/auth/hooks/use-auth-session";
import { SellerSettingsServiceError } from "../services/seller-settings-service";
import { useSellerSettingsQuery, useUpdateSellerSettingsMutation } from "../hooks/use-seller-settings";
import { madInputToMinor, minorToMadInput } from "../utils/seller-settings-money";
import {
  defaultSettingsSection,
  isSettingsSectionId,
  SellerSettingsSectionNavigation,
  settingsPanelId,
  settingsSections,
  settingsTabId,
  type SettingsSectionId,
} from "./seller-settings-section-navigation";
import type {
  DeliveryAvailability,
  DeliveryPricingMode,
  DeliveryRuleType,
  RuntimeMode,
  SellerSettingsDto,
  SellerSettingsFieldError,
  SellerSettingsUpdateInput,
  SupportedCustomerFieldKey,
} from "../types/seller-settings-contracts";

type CustomerFieldForm = Readonly<{
  key: SupportedCustomerFieldKey;
  label: string;
  enabled: boolean;
  required: boolean;
  askOrder: number;
  captureMode?: string;
}>;

type CityRuleForm = Readonly<{
  id: string;
  city: string;
  aliases: string;
  type: DeliveryRuleType;
  amountMad: string;
  priority: number;
}>;

type SettingsForm = Readonly<{
  store: Readonly<{
    businessName: string;
    locale: "ar-MA";
    intendedWhatsappPhoneE164: string;
  }>;
  commerce: Readonly<{
    paymentEnabled: boolean;
    deliveryEnabled: boolean;
    deliveryAvailability: DeliveryAvailability;
    pricingMode: DeliveryPricingMode;
    flatRateMad: string;
    cityRules: readonly CityRuleForm[];
    defaultRuleType: DeliveryRuleType;
    defaultRuleAmountMad: string;
    customerFields: readonly CustomerFieldForm[];
    multiItemEnabled: boolean;
    runtimeMode: RuntimeMode;
    receiptEnabled: boolean;
    receiptSendAfterConfirmation: boolean;
    receiptShowLogo: boolean;
    receiptFooterText: string;
    receiptPaymentMethodLabel: string;
  }> | null;
}>;

type ClientValidationError = Readonly<{ field: string; message: string }>;

const customerFieldLabels: Record<SupportedCustomerFieldKey, string> = {
  fullName: "Full name",
  phone: "Phone number",
  city: "City",
  address: "Delivery address",
  quantity: "Quantity",
};

const defaultCustomerFieldOrder: readonly SupportedCustomerFieldKey[] = ["fullName", "phone", "city", "address", "quantity"];

const availabilityLabels: Record<DeliveryAvailability, string> = {
  all_cities: "Available everywhere",
  selected_cities: "Only selected cities",
  excluded_cities: "Exclude selected cities",
  not_available: "Delivery unavailable",
  not_mentioned: "Do not mention delivery availability",
};

const pricingModeLabels: Record<DeliveryPricingMode, string> = {
  ALL_FREE: "Free delivery",
  FLAT_RATE: "One delivery price",
  CITY_RULES: "City-specific prices",
};

const ruleTypeLabels: Record<DeliveryRuleType, string> = {
  FREE: "Free",
  PAID: "Paid",
  UNAVAILABLE: "Unavailable",
};

function canManage(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function dateLabel(value: string | undefined): string {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not saved yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function normalizeCity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function cityId(value: string, index: number): string {
  const normalized = normalizeCity(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || `city-${index + 1}`;
}

function initialForm(settings: SellerSettingsDto): SettingsForm {
  const commerce = settings.commerce;
  return {
    store: {
      businessName: settings.store.businessName,
      locale: settings.store.locale,
      intendedWhatsappPhoneE164: settings.store.contact.intendedWhatsappPhoneE164 ?? "",
    },
    commerce: commerce
      ? {
          paymentEnabled: commerce.payment.enabled,
          deliveryEnabled: commerce.delivery.enabled,
          deliveryAvailability: commerce.delivery.availability,
          pricingMode: commerce.delivery.pricing.mode,
          flatRateMad: minorToMadInput(commerce.delivery.pricing.flatRateMinor),
          cityRules: (commerce.delivery.pricing.rules ?? []).map((rule, index) => ({
            id: rule.id,
            city: rule.cityKeys[0] ?? "",
            aliases: (rule.aliases ?? []).join(", "),
            type: rule.type,
            amountMad: minorToMadInput(rule.amountMinor),
            priority: rule.priority ?? index + 1,
          })),
          defaultRuleType: commerce.delivery.pricing.defaultRule?.type ?? "PAID",
          defaultRuleAmountMad: minorToMadInput(commerce.delivery.pricing.defaultRule?.amountMinor),
          customerFields: defaultCustomerFieldOrder.map((key, index) => {
            const existing = commerce.requiredCustomerFields.find((field) => field.key === key);
            return {
              key,
              label: existing?.label || customerFieldLabels[key],
              enabled: existing?.enabled ?? key !== "quantity",
              required: existing?.required ?? key !== "quantity",
              askOrder: existing?.askOrder ?? index + 1,
              captureMode: existing?.captureMode,
            };
          }),
          multiItemEnabled: commerce.orderBehavior.multiItemOrderFlow.enabled,
          runtimeMode: commerce.orderBehavior.multiItemOrderFlow.runtimeMode,
          receiptEnabled: commerce.receipt.enabled,
          receiptSendAfterConfirmation: commerce.receipt.sendAfterConfirmation,
          receiptShowLogo: commerce.receipt.showLogo ?? false,
          receiptFooterText: commerce.receipt.footerText ?? "",
          receiptPaymentMethodLabel: commerce.receipt.paymentMethodLabel ?? "",
        }
      : null,
  };
}

function fieldMessage(code: string): string {
  const messages: Record<string, string> = {
    INVALID_BUSINESS_NAME: "Use a store name between 2 and 120 characters.",
    INVALID_PHONE: "Use an international number such as +212600000000.",
    UNSUPPORTED_PAYMENT_METHOD: "Cash on delivery is the only supported payment method right now.",
    INVALID_MINOR_UNITS: "Enter a valid MAD amount with up to two decimals.",
    INVALID_TEXT: "Use up to 240 characters.",
    DUPLICATE_CITY_RULE: "Each city can appear only once.",
    DUPLICATE_FIELD_KEY: "Each customer detail can appear only once.",
    UNSUPPORTED_FIELD_KEY: "This customer detail is not supported.",
    UNKNOWN_PROPERTY: "This setting is not supported here.",
    FORBIDDEN_PROPERTY: "This setting cannot be changed from this page.",
    UNTRUSTED_MEDIA_REFERENCE: "Logo changes must use the trusted upload flow.",
  };
  return messages[code] ?? "Please review this field.";
}

function errorMap(errors: readonly SellerSettingsFieldError[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const error of errors) next[error.field] = fieldMessage(error.code);
  return next;
}

function hasFieldError(errors: Record<string, string>, prefix: string): boolean {
  return Object.keys(errors).some((field) => field === prefix || field.startsWith(`${prefix}.`));
}

function firstErrorSection(errors: Record<string, string>): SettingsSectionId | null {
  const first = Object.keys(errors)[0];
  if (!first) return null;
  if (first.startsWith("store")) return "store";
  if (first.startsWith("commerce.payment")) return "payment";
  if (first.startsWith("commerce.delivery")) return "delivery";
  if (first.startsWith("commerce.requiredCustomerFields")) return "customer";
  if (first.startsWith("commerce.orderBehavior")) return "orders";
  if (first.startsWith("commerce.receipt")) return "receipt";
  return null;
}

function validateForm(form: SettingsForm): readonly ClientValidationError[] {
  const errors: ClientValidationError[] = [];
  const name = form.store.businessName.trim().replace(/\s+/gu, " ");
  if (name.length < 2 || name.length > 120) errors.push({ field: "store.businessName", message: "Use a store name between 2 and 120 characters." });
  if (form.store.intendedWhatsappPhoneE164 && !/^\+[1-9][0-9]{1,14}$/u.test(form.store.intendedWhatsappPhoneE164.replace(/[\s().-]+/gu, ""))) {
    errors.push({ field: "store.contact.intendedWhatsappPhoneE164", message: "Use an international number such as +212600000000." });
  }
  if (!form.commerce) return errors;
  if (form.commerce.pricingMode === "FLAT_RATE" && madInputToMinor(form.commerce.flatRateMad) === null) {
    errors.push({ field: "commerce.delivery.pricing.flatRateMinor", message: "Enter a valid MAD amount with up to two decimals." });
  }
  if (form.commerce.pricingMode === "CITY_RULES") {
    const cities = new Set<string>();
    form.commerce.cityRules.forEach((rule, index) => {
      const city = normalizeCity(rule.city);
      if (!city) errors.push({ field: `commerce.delivery.pricing.rules.${index}.cityKeys`, message: "Enter a city name." });
      const key = city.toLocaleLowerCase("en-US");
      if (key && cities.has(key)) errors.push({ field: `commerce.delivery.pricing.rules.${index}.cityKeys`, message: "Each city can appear only once." });
      cities.add(key);
      if (rule.type === "PAID" && madInputToMinor(rule.amountMad) === null) {
        errors.push({ field: `commerce.delivery.pricing.rules.${index}.amountMinor`, message: "Enter a valid MAD amount." });
      }
    });
    if (form.commerce.defaultRuleType === "PAID" && madInputToMinor(form.commerce.defaultRuleAmountMad) === null) {
      errors.push({ field: "commerce.delivery.pricing.defaultRule.amountMinor", message: "Enter a valid default delivery price." });
    }
  }
  return errors;
}

function updatePayload(form: SettingsForm): SellerSettingsUpdateInput {
  const phone = form.store.intendedWhatsappPhoneE164.replace(/[\s().-]+/gu, "").trim();
  return {
    store: {
      businessName: form.store.businessName.trim().replace(/\s+/gu, " "),
      contact: { intendedWhatsappPhoneE164: phone || null },
    },
    ...(form.commerce
      ? {
          commerce: {
            payment: { method: "COD", enabled: form.commerce.paymentEnabled },
            delivery: {
              enabled: form.commerce.deliveryEnabled,
              availability: form.commerce.deliveryAvailability,
              pricing: {
                mode: form.commerce.pricingMode,
                currency: "MAD",
                ...(form.commerce.pricingMode === "FLAT_RATE"
                  ? { flatRateMinor: madInputToMinor(form.commerce.flatRateMad) ?? 0 }
                  : {}),
                ...(form.commerce.pricingMode === "CITY_RULES"
                  ? {
                      rules: form.commerce.cityRules.map((rule, index) => ({
                        id: rule.id || cityId(rule.city, index),
                        type: rule.type,
                        cityKeys: [normalizeCity(rule.city).toLocaleLowerCase("en-US")],
                        ...(rule.aliases.trim()
                          ? { aliases: rule.aliases.split(",").map((alias) => alias.trim()).filter(Boolean) }
                          : {}),
                        ...(rule.type === "PAID" ? { amountMinor: madInputToMinor(rule.amountMad) ?? 0 } : {}),
                        priority: index + 1,
                      })),
                      defaultRule: {
                        id: "default",
                        type: form.commerce.defaultRuleType,
                        ...(form.commerce.defaultRuleType === "PAID"
                          ? { amountMinor: madInputToMinor(form.commerce.defaultRuleAmountMad) ?? 0 }
                          : {}),
                      },
                    }
                  : {}),
              },
            },
            requiredCustomerFields: form.commerce.customerFields.map((field, index) => ({
              key: field.key,
              label: customerFieldLabels[field.key],
              required: field.enabled && field.required,
              enabled: field.enabled,
              askOrder: index + 1,
              ...(field.captureMode ? { captureMode: field.captureMode } : {}),
            })),
            orderBehavior: {
              multiItemOrderFlow: {
                enabled: form.commerce.multiItemEnabled,
                runtimeMode: form.commerce.runtimeMode,
              },
            },
            receipt: {
              enabled: form.commerce.receiptEnabled,
              sendAfterConfirmation: form.commerce.receiptSendAfterConfirmation,
              showLogo: form.commerce.receiptShowLogo,
              ...(form.commerce.receiptFooterText.trim() ? { footerText: form.commerce.receiptFooterText.trim() } : {}),
              ...(form.commerce.receiptPaymentMethodLabel.trim() ? { paymentMethodLabel: form.commerce.receiptPaymentMethodLabel.trim() } : {}),
            },
          },
        }
      : {}),
  };
}

function SwitchRow(props: Readonly<{
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}>) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-marketing-border bg-background px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{props.label}</p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{props.description}</p>
      </div>
      <Switch aria-label={props.label} checked={props.checked} disabled={props.disabled} onCheckedChange={props.onCheckedChange} />
    </div>
  );
}

function FieldError({ id, message }: Readonly<{ id?: string; message?: string }>) {
  if (!message) return null;
  return <p className="mt-2 text-sm leading-5 text-destructive" id={id} role="alert">{message}</p>;
}

function controlIdForFieldError(field: string | undefined): string | null {
  if (field === "store.businessName") return "settings-business-name";
  if (field === "store.contact.intendedWhatsappPhoneE164") return "settings-phone";
  if (field === "commerce.delivery.pricing.flatRateMinor") return "settings-delivery-flat-rate";
  if (field === "commerce.delivery.pricing.defaultRule.amountMinor") return "settings-delivery-default-rule-amount";
  if (field === "commerce.receipt.paymentMethodLabel") return "settings-receipt-payment-label";
  if (field === "commerce.receipt.footerText") return "settings-receipt-footer";
  if (field?.endsWith(".cityKeys")) return `settings-delivery-rule-${field.split(".")[4]}-city`;
  if (field?.endsWith(".amountMinor")) return `settings-delivery-rule-${field.split(".")[4]}-amount`;
  return null;
}

function ReadinessBanner({ settings }: Readonly<{ settings: SellerSettingsDto }>) {
  const status = settings.readiness.status;
  const ready = status === "READY";
  const invalid = status === "SELLER_COMMERCE_CONFIG_INVALID";
  const missing = status === "SELLER_COMMERCE_CONFIG_REQUIRED" || status === "WORKSPACE_PROFILE_REQUIRED";
  const degraded = status === "DEGRADED";
  return (
    <div
      className={cn(
        "rounded-lg border px-3.5 py-2.5",
        ready && "border-emerald-200 bg-emerald-50 text-emerald-950",
        invalid && "border-red-200 bg-red-50 text-red-950",
        missing && "border-amber-200 bg-amber-50 text-amber-950",
        degraded && "border-sky-200 bg-sky-50 text-sky-950",
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        {ready ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" /> : <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />}
        <div className="min-w-0">
          <p className="font-semibold">
            {ready ? "Ready" : invalid ? "Needs attention" : missing ? "Setup incomplete" : "Temporarily unavailable"}
          </p>
          <p className="mt-0.5 text-sm leading-5">
            {ready
              ? "Your store settings are ready for order testing."
              : invalid
                ? "Some saved commerce settings need backend review before they can be edited here."
                : missing
                  ? "Store profile loaded, but commerce settings are not available yet."
                  : "Settings could not be fully checked. Retry shortly."}
          </p>
        </div>
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-20 animate-pulse rounded-lg bg-muted" />
      <div className="h-12 animate-pulse rounded-lg border border-marketing-border bg-white" />
      <div className="h-72 animate-pulse rounded-lg border border-marketing-border bg-white" />
    </div>
  );
}

export function SellerSettingsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { memberships } = useAuthSession();
  const role = memberships[0]?.role;
  const allowed = canManage(role);
  const settingsQuery = useSellerSettingsQuery(allowed);
  const updateMutation = useUpdateSellerSettingsMutation();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const activePanelRef = useRef<HTMLElement | null>(null);
  const pendingPanelFocus = useRef<SettingsSectionId | null>(null);
  const pendingFieldFocus = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const sectionParam = searchParams.get("section");
  const activeSection = isSettingsSectionId(sectionParam) ? sectionParam : defaultSettingsSection;

  useEffect(() => {
    if (sectionParam === null || isSettingsSectionId(sectionParam)) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("section", defaultSettingsSection);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router, searchParams, sectionParam]);

  useEffect(() => {
    if (pendingPanelFocus.current !== activeSection) return;
    pendingPanelFocus.current = null;
    const field = pendingFieldFocus.current;
    pendingFieldFocus.current = null;
    const controlId = controlIdForFieldError(field ?? undefined);
    const control = controlId ? document.getElementById(controlId) : null;
    (control ?? activePanelRef.current)?.focus();
  }, [activeSection]);

  if (settingsQuery.data && form === null) {
    const next = initialForm(settingsQuery.data);
    setForm(next);
    setSavedSnapshot(JSON.stringify(next));
  }

  const isDirty = form ? JSON.stringify(form) !== savedSnapshot : false;
  const isSaving = updateMutation.isPending;
  const commerceAvailable = Boolean(form?.commerce && settingsQuery.data?.commerce);

  const sectionErrorFlags = useMemo(() => ({
    store: hasFieldError(fieldErrors, "store"),
    payment: hasFieldError(fieldErrors, "commerce.payment"),
    delivery: hasFieldError(fieldErrors, "commerce.delivery"),
    customer: hasFieldError(fieldErrors, "commerce.requiredCustomerFields"),
    orders: hasFieldError(fieldErrors, "commerce.orderBehavior"),
    receipt: hasFieldError(fieldErrors, "commerce.receipt"),
  }), [fieldErrors]);

  function patch(next: Partial<SettingsForm>) {
    if (!form || isSaving || saveInFlightRef.current) return;
    setForm({ ...form, ...next });
    setFieldErrors({});
    setGlobalError(null);
  }

  function patchCommerce(next: Partial<NonNullable<SettingsForm["commerce"]>>) {
    if (!form?.commerce || isSaving) return;
    patch({ commerce: { ...form.commerce, ...next } });
  }

  function applyValidationErrors(errors: readonly ClientValidationError[]) {
    const next: Record<string, string> = {};
    for (const error of errors) next[error.field] = error.message;
    setFieldErrors(next);
    const field = Object.keys(next)[0];
    const section = firstErrorSection(next);
    if (section) revealSection(section, field);
  }

  function selectSection(section: SettingsSectionId) {
    if (section === activeSection && sectionParam === section) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("section", section);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function revealSection(section: SettingsSectionId, field?: string) {
    const focusTarget = () => {
      const controlId = controlIdForFieldError(field);
      const control = controlId ? document.getElementById(controlId) : null;
      (control ?? activePanelRef.current)?.focus();
    };
    if (section === activeSection) {
      requestAnimationFrame(focusTarget);
      return;
    }
    pendingPanelFocus.current = section;
    pendingFieldFocus.current = field ?? null;
    selectSection(section);
  }

  async function save() {
    if (!form || isSaving || saveInFlightRef.current || !isDirty) return;
    saveInFlightRef.current = true;

    try {
      const validationErrors = validateForm(form);
      if (validationErrors.length) {
        applyValidationErrors(validationErrors);
        setGlobalError("Please review the highlighted settings.");
        return;
      }

      try {
        const saved = await updateMutation.mutateAsync(updatePayload(form));
        const next = initialForm(saved);
        setForm(next);
        setSavedSnapshot(JSON.stringify(next));
        setFieldErrors({});
        setGlobalError(null);
        toast.success("Settings saved.");
        if (liveRef.current) liveRef.current.textContent = "Settings saved.";
      } catch (error) {
        if (error instanceof SellerSettingsServiceError) {
          const mapped = errorMap(error.fieldErrors ?? []);
          setFieldErrors(mapped);
          setGlobalError(error.message);
          const field = Object.keys(mapped)[0];
          const section = firstErrorSection(mapped);
          if (section) revealSection(section, field);
          toast.error(error.message);
          return;
        }
        setGlobalError("Settings could not be saved. Please try again.");
        toast.error("Settings could not be saved.");
      }
    } finally {
      saveInFlightRef.current = false;
    }
  }

  function discard() {
    if (!settingsQuery.data) return;
    const next = initialForm(settingsQuery.data);
    setForm(next);
    setSavedSnapshot(JSON.stringify(next));
    setFieldErrors({});
    setGlobalError(null);
  }

  if (!allowed) {
    return (
      <section className="rounded-lg border border-marketing-border bg-marketing-surface p-5">
        <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Configuration</p>
        <h2 className="mt-2 text-2xl font-semibold text-foreground">Settings</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Store settings are available to workspace owners and admins.
        </p>
      </section>
    );
  }

  if (settingsQuery.isLoading || !form) return <SettingsSkeleton />;

  if (settingsQuery.error) {
    return (
      <section className="rounded-lg border border-marketing-border bg-marketing-surface p-5">
        <AlertCircle aria-hidden="true" className="size-6 text-destructive" />
        <h2 className="mt-3 text-xl font-semibold">Settings could not be loaded</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Retry without leaving the dashboard shell.</p>
        <Button className="mt-4 min-h-11" onClick={() => void settingsQuery.refetch()} type="button" variant="outline">
          <RefreshCw aria-hidden="true" />
          Retry
        </Button>
      </section>
    );
  }

  const settings = settingsQuery.data;
  const activeSectionDefinition = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];

  return (
    <div className="space-y-4">
      <p className="sr-only" aria-live="polite" ref={liveRef} />
      <header className="px-0.5 py-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.1em] text-marketing-primary uppercase">Configuration</p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">Settings</h1>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
              Manage how your store receives orders, handles delivery and collects customer information.
            </p>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">Last saved {dateLabel(settings?.updatedAt)}</p>
        </div>
      </header>

      {settings ? <ReadinessBanner settings={settings} /> : null}

      {globalError ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-foreground" role="alert">
          {globalError}
        </div>
      ) : null}

      <SellerSettingsSectionNavigation activeSection={activeSection} errorSections={sectionErrorFlags} onSelect={selectSection} />

      <div className="min-w-0 space-y-4">
        <div className="mx-auto min-w-0 w-full max-w-5xl">
          {activeSection === "store" ? (
          <section
            className="rounded-lg border border-marketing-border bg-marketing-surface p-4 sm:p-5"
            aria-labelledby={settingsTabId("store")}
            id={settingsPanelId()}
            ref={activePanelRef}
            role="tabpanel"
            tabIndex={-1}
          >
            <SectionHeading icon={Store} title={activeSectionDefinition.label} description={activeSectionDefinition.description} hasError={sectionErrorFlags.store} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="settings-business-name">Business name</Label>
                <Input
                  aria-invalid={Boolean(fieldErrors["store.businessName"])}
                  aria-describedby={fieldErrors["store.businessName"] ? "settings-business-name-error" : undefined}
                  className="mt-2 min-h-11"
                  id="settings-business-name"
                  maxLength={120}
                  value={form.store.businessName}
                  onChange={(event) => patch({ store: { ...form.store, businessName: event.target.value } })}
                />
                <FieldError id="settings-business-name-error" message={fieldErrors["store.businessName"]} />
              </div>
              <div>
                <Label htmlFor="settings-locale">Store language</Label>
                <Input className="mt-2 min-h-11" id="settings-locale" readOnly value="Moroccan Arabic (ar-MA)" />
                <p className="mt-2 text-sm leading-5 text-muted-foreground">Language is currently fixed for this workspace.</p>
              </div>
              <div>
                <Label htmlFor="settings-phone">Intended WhatsApp phone</Label>
                <Input
                  aria-invalid={Boolean(fieldErrors["store.contact.intendedWhatsappPhoneE164"])}
                  aria-describedby={fieldErrors["store.contact.intendedWhatsappPhoneE164"] ? "settings-phone-error" : undefined}
                  className="mt-2 min-h-11"
                  id="settings-phone"
                  inputMode="tel"
                  placeholder="+212600000000"
                  value={form.store.intendedWhatsappPhoneE164}
                  onChange={(event) => patch({ store: { ...form.store, intendedWhatsappPhoneE164: event.target.value } })}
                />
                <FieldError id="settings-phone-error" message={fieldErrors["store.contact.intendedWhatsappPhoneE164"]} />
              </div>
              <div className="rounded-lg border border-marketing-border bg-background px-3 py-3">
                <p className="text-sm font-semibold text-foreground">Store logo</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {settings?.store.logo ? "A trusted logo is saved for this workspace." : "No trusted logo is saved yet."}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Logo upload stays in the existing trusted upload flow.</p>
              </div>
            </div>
          </section>
          ) : null}

          {activeSection !== "store" && !commerceAvailable ? (
            <section
              aria-labelledby={settingsTabId(activeSection)}
              className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950"
              id={settingsPanelId()}
              ref={activePanelRef}
              role="tabpanel"
              tabIndex={-1}
            >
              <div className="flex items-start gap-3">
                <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                <div>
                  <h3 className="font-semibold">Commerce settings need setup</h3>
                  <p className="mt-1 text-sm leading-6">
                    This page will not create fake defaults. Once commerce settings exist in the backend, payment, delivery, customer information, order and receipt settings appear here.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {form.commerce && commerceAvailable ? (
            <>
              {activeSection === "payment" ? (
              <section className="rounded-lg border border-marketing-border bg-marketing-surface p-4 sm:p-5" aria-labelledby={settingsTabId("payment")} id={settingsPanelId()} ref={activePanelRef} role="tabpanel" tabIndex={-1}>
                <SectionHeading icon={CircleDollarSign} title={activeSectionDefinition.label} description={activeSectionDefinition.description} hasError={sectionErrorFlags.payment} />
                <div className="mt-4 space-y-3">
                  <SwitchRow
                    checked={form.commerce.paymentEnabled}
                    label="Cash on delivery"
                    description="Customers pay when the order is delivered. This is the only supported payment method right now."
                    onCheckedChange={(checked) => patchCommerce({ paymentEnabled: checked })}
                  />
                </div>
              </section>
              ) : null}

              {activeSection === "delivery" ? (
              <section className="rounded-lg border border-marketing-border bg-marketing-surface p-4 sm:p-5" aria-labelledby={settingsTabId("delivery")} id={settingsPanelId()} ref={activePanelRef} role="tabpanel" tabIndex={-1}>
                <SectionHeading icon={MapPin} title={activeSectionDefinition.label} description={activeSectionDefinition.description} hasError={sectionErrorFlags.delivery} />
                <div className="mt-4 grid gap-4">
                  <SwitchRow
                    checked={form.commerce.deliveryEnabled}
                    label="Offer delivery"
                    description="When enabled, the WhatsApp agent can collect delivery details during checkout."
                    onCheckedChange={(checked) => patchCommerce({ deliveryEnabled: checked })}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      id="settings-delivery-availability"
                      label="Delivery availability"
                      value={form.commerce.deliveryAvailability}
                      options={availabilityLabels}
                      onChange={(value) => patchCommerce({ deliveryAvailability: value as DeliveryAvailability })}
                    />
                    <SelectField
                      id="settings-delivery-pricing"
                      label="Delivery pricing"
                      value={form.commerce.pricingMode}
                      options={pricingModeLabels}
                      onChange={(value) => patchCommerce({ pricingMode: value as DeliveryPricingMode })}
                    />
                  </div>
                  {form.commerce.pricingMode === "FLAT_RATE" ? (
                    <MoneyField
                      error={fieldErrors["commerce.delivery.pricing.flatRateMinor"]}
                      id="settings-delivery-flat-rate"
                      label="Delivery price"
                      value={form.commerce.flatRateMad}
                      onChange={(value) => patchCommerce({ flatRateMad: value })}
                    />
                  ) : null}
                  {form.commerce.pricingMode === "CITY_RULES" ? (
                    <CityRulesEditor
                      errors={fieldErrors}
                      rules={form.commerce.cityRules}
                      defaultRuleAmountMad={form.commerce.defaultRuleAmountMad}
                      defaultRuleType={form.commerce.defaultRuleType}
                      onChange={(cityRules) => patchCommerce({ cityRules })}
                      onDefaultAmountChange={(defaultRuleAmountMad) => patchCommerce({ defaultRuleAmountMad })}
                      onDefaultTypeChange={(defaultRuleType) => patchCommerce({ defaultRuleType })}
                    />
                  ) : null}
                </div>
              </section>
              ) : null}

              {activeSection === "customer" ? (
              <section className="rounded-lg border border-marketing-border bg-marketing-surface p-4 sm:p-5" aria-labelledby={settingsTabId("customer")} id={settingsPanelId()} ref={activePanelRef} role="tabpanel" tabIndex={-1}>
                <SectionHeading icon={UserRound} title={activeSectionDefinition.label} description={activeSectionDefinition.description} hasError={sectionErrorFlags.customer} />
                <div className="mt-4 grid gap-3">
                  {form.commerce.customerFields.map((field) => (
                    <div className="grid gap-3 rounded-lg border border-marketing-border bg-background px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" key={field.key}>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{customerFieldLabels[field.key]}</p>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                          {field.key === "quantity" ? "Useful when customers order a custom quantity." : "Collected during order completion."}
                        </p>
                      </div>
                      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                        <input
                          checked={field.enabled}
                          className="size-4 accent-emerald-700"
                          type="checkbox"
                          onChange={(event) => patchCommerce({ customerFields: form.commerce!.customerFields.map((item) => item.key === field.key ? { ...item, enabled: event.target.checked, required: event.target.checked ? item.required : false } : item) })}
                        />
                        Collect
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                        <input
                          checked={field.required}
                          className="size-4 accent-emerald-700"
                          disabled={!field.enabled}
                          type="checkbox"
                          onChange={(event) => patchCommerce({ customerFields: form.commerce!.customerFields.map((item) => item.key === field.key ? { ...item, required: event.target.checked } : item) })}
                        />
                        Required
                      </label>
                    </div>
                  ))}
                </div>
              </section>
              ) : null}

              {activeSection === "orders" ? (
              <section className="rounded-lg border border-marketing-border bg-marketing-surface p-4 sm:p-5" aria-labelledby={settingsTabId("orders")} id={settingsPanelId()} ref={activePanelRef} role="tabpanel" tabIndex={-1}>
                <SectionHeading icon={PackagePlus} title={activeSectionDefinition.label} description={activeSectionDefinition.description} hasError={sectionErrorFlags.orders} />
                <div className="mt-4 grid gap-4">
                  <SwitchRow
                    checked={form.commerce.multiItemEnabled}
                    label="Allow multiple products in one order"
                    description="Customers can build an order with more than one item before final confirmation."
                    onCheckedChange={(checked) => patchCommerce({ multiItemEnabled: checked })}
                  />
                  <SelectField
                    id="settings-order-flow-mode"
                    label="Order collection style"
                    value={form.commerce.runtimeMode}
                    options={{ disabled: "Off", dry_run: "Test order collection", guarded: "Live order collection" }}
                    onChange={(value) => patchCommerce({ runtimeMode: value as RuntimeMode })}
                  />
                </div>
              </section>
              ) : null}

              {activeSection === "receipt" ? (
              <section className="rounded-lg border border-marketing-border bg-marketing-surface p-4 sm:p-5" aria-labelledby={settingsTabId("receipt")} id={settingsPanelId()} ref={activePanelRef} role="tabpanel" tabIndex={-1}>
                <SectionHeading icon={FileText} title={activeSectionDefinition.label} description={activeSectionDefinition.description} hasError={sectionErrorFlags.receipt} />
                <div className="mt-4 grid gap-4">
                  <SwitchRow
                    checked={form.commerce.receiptEnabled}
                    label="Generate receipt"
                    description="Create a receipt after the customer confirms the order."
                    onCheckedChange={(checked) => patchCommerce({ receiptEnabled: checked })}
                  />
                  <SwitchRow
                    checked={form.commerce.receiptSendAfterConfirmation}
                    label="Send receipt after confirmation"
                    description="Send the generated receipt in WhatsApp after confirmation."
                    onCheckedChange={(checked) => patchCommerce({ receiptSendAfterConfirmation: checked })}
                  />
                  <SwitchRow
                    checked={form.commerce.receiptShowLogo}
                    label="Show saved logo on receipt"
                    description="Uses the logo already trusted by the workspace upload flow."
                    onCheckedChange={(checked) => patchCommerce({ receiptShowLogo: checked })}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="settings-receipt-payment-label">Payment label</Label>
                      <Input aria-describedby={fieldErrors["commerce.receipt.paymentMethodLabel"] ? "settings-receipt-payment-label-error" : undefined} aria-invalid={Boolean(fieldErrors["commerce.receipt.paymentMethodLabel"])} className="mt-2 min-h-11" id="settings-receipt-payment-label" value={form.commerce.receiptPaymentMethodLabel} onChange={(event) => patchCommerce({ receiptPaymentMethodLabel: event.target.value })} />
                      <FieldError id="settings-receipt-payment-label-error" message={fieldErrors["commerce.receipt.paymentMethodLabel"]} />
                    </div>
                    <div>
                      <Label htmlFor="settings-receipt-footer">Receipt footer</Label>
                      <Textarea aria-describedby={fieldErrors["commerce.receipt.footerText"] ? "settings-receipt-footer-error" : undefined} aria-invalid={Boolean(fieldErrors["commerce.receipt.footerText"])} className="mt-2 min-h-24" id="settings-receipt-footer" value={form.commerce.receiptFooterText} onChange={(event) => patchCommerce({ receiptFooterText: event.target.value })} />
                      <FieldError id="settings-receipt-footer-error" message={fieldErrors["commerce.receipt.footerText"]} />
                    </div>
                  </div>
                </div>
              </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className={cn(
        "mx-auto w-full max-w-5xl rounded-lg border border-marketing-border bg-white p-3",
        isDirty && "sticky bottom-3 z-20 bg-white/95 shadow-[0_18px_36px_-24px_oklch(0.2_0.04_155/0.35)] backdrop-blur",
      )}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-semibold text-foreground">{isDirty ? "You have unsaved changes" : "Settings are up to date"}</p>
            <p className="text-muted-foreground">One save updates store and commerce settings together.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-11 w-full sm:w-auto" disabled={!isDirty || isSaving} onClick={discard} type="button" variant="outline">
              <RotateCcw aria-hidden="true" />
              Discard changes
            </Button>
            <Button aria-busy={isSaving} className="min-h-11 w-full sm:w-auto" disabled={!isDirty || isSaving} onClick={() => void save()} type="button">
              {isSaving ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Save aria-hidden="true" />}
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ icon: Icon, title, description, hasError }: Readonly<{ icon: typeof Store; title: string; description: string; hasError: boolean }>) {
  return (
    <div className="flex items-start gap-3">
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg ring-1", hasError ? "bg-destructive/10 text-destructive ring-destructive/20" : "bg-marketing-subtle text-marketing-primary ring-marketing-border")}>
        <Icon aria-hidden="true" className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          {hasError ? <Badge variant="destructive">Review</Badge> : null}
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SelectField<TValue extends string>({ id, label, value, options, onChange }: Readonly<{ id?: string; label: string; value: TValue; options: Record<TValue, string>; onChange: (value: TValue) => void }>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div>
      <Label htmlFor={fieldId}>{label}</Label>
      <select
        className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        id={fieldId}
        value={value}
        onChange={(event) => onChange(event.target.value as TValue)}
      >
        {Object.entries(options).map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{String(optionLabel)}</option>
        ))}
      </select>
    </div>
  );
}

function MoneyField({ id, label, value, error, onChange }: Readonly<{ id?: string; label: string; value: string; error?: string; onChange: (value: string) => void }>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  return (
    <div>
      <Label htmlFor={fieldId}>{label}</Label>
      <div className="mt-2 flex min-w-0 items-center rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <Input aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} className="min-h-11 border-0 focus-visible:ring-0" id={fieldId} inputMode="decimal" placeholder="0.00" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="shrink-0 px-3 text-sm font-semibold text-muted-foreground">MAD</span>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function CityRulesEditor(props: Readonly<{
  rules: readonly CityRuleForm[];
  errors: Record<string, string>;
  defaultRuleType: DeliveryRuleType;
  defaultRuleAmountMad: string;
  onChange: (rules: readonly CityRuleForm[]) => void;
  onDefaultTypeChange: (type: DeliveryRuleType) => void;
  onDefaultAmountChange: (value: string) => void;
}>) {
  function updateRule(index: number, next: Partial<CityRuleForm>) {
    props.onChange(props.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...next } : rule));
  }

  function addRule() {
    props.onChange([
      ...props.rules,
      { id: `city-${props.rules.length + 1}`, city: "", aliases: "", type: "PAID", amountMad: "0.00", priority: props.rules.length + 1 },
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">City rules</p>
          <p className="text-sm leading-5 text-muted-foreground">Add a city once, then choose whether delivery is free, paid, or unavailable.</p>
        </div>
        <Button className="min-h-11 w-full sm:w-auto" onClick={addRule} type="button" variant="outline">
          <ClipboardList aria-hidden="true" />
          Add city
        </Button>
      </div>
      <div className="space-y-3">
        {props.rules.map((rule, index) => (
          <div className="rounded-lg border border-marketing-border bg-background p-3" key={`${rule.id}-${index}`}>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_auto] md:items-start">
              <div>
                <Label htmlFor={`settings-delivery-rule-${index}-city`}>City</Label>
                <Input aria-describedby={props.errors[`commerce.delivery.pricing.rules.${index}.cityKeys`] ? `settings-delivery-rule-${index}-city-error` : undefined} aria-invalid={Boolean(props.errors[`commerce.delivery.pricing.rules.${index}.cityKeys`])} className="mt-2 min-h-11" id={`settings-delivery-rule-${index}-city`} value={rule.city} onChange={(event) => updateRule(index, { city: event.target.value, id: cityId(event.target.value, index) })} />
                <FieldError id={`settings-delivery-rule-${index}-city-error`} message={props.errors[`commerce.delivery.pricing.rules.${index}.cityKeys`]} />
              </div>
              <SelectField id={`settings-delivery-rule-${index}-type`} label="Rule" value={rule.type} options={ruleTypeLabels} onChange={(value) => updateRule(index, { type: value })} />
              <MoneyField error={props.errors[`commerce.delivery.pricing.rules.${index}.amountMinor`]} id={`settings-delivery-rule-${index}-amount`} label="Price" value={rule.amountMad} onChange={(value) => updateRule(index, { amountMad: value })} />
              <Button
                aria-label={`Remove ${rule.city || "city rule"}`}
                className="mt-0 min-h-11 w-full md:mt-7 md:w-auto"
                onClick={() => props.onChange(props.rules.filter((_, ruleIndex) => ruleIndex !== index))}
                type="button"
                variant="outline"
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            </div>
            <div className="mt-3">
              <Label htmlFor={`settings-delivery-rule-${index}-aliases`}>Aliases</Label>
              <Input className="mt-2 min-h-11" id={`settings-delivery-rule-${index}-aliases`} placeholder="Casa, Dar Beida" value={rule.aliases} onChange={(event) => updateRule(index, { aliases: event.target.value })} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 rounded-lg border border-marketing-border bg-background p-3 sm:grid-cols-2">
        <SelectField id="settings-delivery-default-rule-type" label="Default delivery rule" value={props.defaultRuleType} options={ruleTypeLabels} onChange={props.onDefaultTypeChange} />
        <MoneyField error={props.errors["commerce.delivery.pricing.defaultRule.amountMinor"]} id="settings-delivery-default-rule-amount" label="Default price" value={props.defaultRuleAmountMad} onChange={props.onDefaultAmountChange} />
      </div>
    </div>
  );
}
