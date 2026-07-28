import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { stepIndex, WIZARD_STEPS } from "./customer-owned-meta-app-wizard-view-models";
import type { WizardStep } from "./customer-owned-meta-app-wizard-types";

export function CustomerOwnedMetaAppWizardStepper({ currentStep }: Readonly<{ currentStep: WizardStep }>) {
  const currentIndex = stepIndex(currentStep);

  return (
    <nav aria-label="WhatsApp setup progress" className="grid gap-2 sm:grid-cols-4 lg:block lg:space-y-2">
      {WIZARD_STEPS.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors",
              isCurrent && "border-emerald-300 bg-emerald-50 text-emerald-950",
              isComplete && "border-emerald-200 bg-white text-foreground",
              !isCurrent && !isComplete && "border-border bg-background text-muted-foreground",
            )}
            key={step.id}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                isComplete && "border-emerald-500 bg-emerald-600 text-white",
                isCurrent && "border-emerald-500 bg-white text-emerald-700",
                !isCurrent && !isComplete && "border-border bg-muted text-muted-foreground",
              )}
            >
              {isComplete ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
            </span>
            <span className="min-w-0 truncate">{step.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
