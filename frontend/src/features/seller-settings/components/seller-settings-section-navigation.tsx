"use client";

import {
  AlertCircle,
  CircleDollarSign,
  FileText,
  MapPin,
  PackagePlus,
  Store,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export const settingsSections = [
  { id: "store", label: "Store profile", description: "Basic store details used by order settings.", icon: Store },
  { id: "payment", label: "Payment", description: "Choose how customers pay when they confirm an order.", icon: CircleDollarSign },
  { id: "delivery", label: "Delivery", description: "Set where delivery is available and how much it costs.", icon: MapPin },
  { id: "customer", label: "Customer information", description: "Choose which details the WhatsApp agent collects before order confirmation.", icon: UserRound },
  { id: "orders", label: "Order preferences", description: "Control how larger orders are handled by the order flow.", icon: PackagePlus },
  { id: "receipt", label: "Receipt preferences", description: "Choose receipt behavior after an order is confirmed.", icon: FileText },
] as const;

export type SettingsSectionId = (typeof settingsSections)[number]["id"];

export const defaultSettingsSection: SettingsSectionId = "store";

export function isSettingsSectionId(value: string | null): value is SettingsSectionId {
  return settingsSections.some((section) => section.id === value);
}

export function settingsTabId(section: SettingsSectionId): string {
  return `settings-tab-${section}`;
}

export function settingsPanelId(): string {
  return "settings-panel";
}

export function SellerSettingsSectionNavigation({
  activeSection,
  errorSections,
  onSelect,
}: Readonly<{
  activeSection: SettingsSectionId;
  errorSections: Readonly<Record<SettingsSectionId, boolean>>;
  onSelect: (section: SettingsSectionId) => void;
}>) {
  const tabRefs = useRef<Partial<Record<SettingsSectionId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    tabRefs.current[activeSection]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeSection]);

  function moveSelection(event: KeyboardEvent<HTMLButtonElement>, current: SettingsSectionId) {
    const currentIndex = settingsSections.findIndex((section) => section.id === current);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % settingsSections.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + settingsSections.length) % settingsSections.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = settingsSections.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = settingsSections[nextIndex].id;
    onSelect(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-marketing-border bg-marketing-surface p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        aria-label="Settings sections"
        className="flex min-w-max gap-1 xl:grid xl:min-w-0 xl:grid-cols-6"
        role="tablist"
      >
        {settingsSections.map((section) => {
          const Icon = section.icon;
          const active = section.id === activeSection;
          const hasError = errorSections[section.id];
          return (
            <button
              aria-controls={settingsPanelId()}
              aria-selected={active}
              className={cn(
                "flex min-h-11 min-w-40 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 xl:min-w-0",
                active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                hasError && !active ? "text-destructive" : "",
              )}
              id={settingsTabId(section.id)}
              key={section.id}
              onClick={() => onSelect(section.id)}
              onKeyDown={(event) => moveSelection(event, section.id)}
              ref={(node) => { tabRefs.current[section.id] = node; }}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span className="whitespace-nowrap">{section.label}</span>
              {hasError ? (
                <span className="shrink-0" title="This section needs attention">
                  <AlertCircle aria-hidden="true" className="size-4" />
                  <span className="sr-only">Needs attention</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
