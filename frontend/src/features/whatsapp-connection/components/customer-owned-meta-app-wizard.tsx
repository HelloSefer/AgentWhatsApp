"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { manualConnectionIssueMessage } from "../services/embedded-signup-completion-service";
import { CustomerOwnedMetaAppConnectionStep } from "./customer-owned-meta-app-connection-step";
import { CustomerOwnedMetaAppCredentialsStep } from "./customer-owned-meta-app-credentials-step";
import { CustomerOwnedMetaAppNumberStep } from "./customer-owned-meta-app-number-step";
import { CustomerOwnedMetaAppPrepareStep } from "./customer-owned-meta-app-prepare-step";
import { CustomerOwnedMetaAppWizardStepper } from "./customer-owned-meta-app-wizard-stepper";
import { whatsappConnectionQueryKey, type CustomerOwnedMetaAppWizardProps } from "./customer-owned-meta-app-wizard-types";
import { setupTitle } from "./customer-owned-meta-app-wizard-view-models";
import { useCustomerOwnedMetaAppWizard } from "./use-customer-owned-meta-app-wizard";

export { whatsappConnectionQueryKey };

export function CustomerOwnedMetaAppWizard({
  initialConnection,
  mode = "new",
  onCancel,
  onDone,
  selectedPhoneFromStatus = null,
}: CustomerOwnedMetaAppWizardProps) {
  const wizard = useCustomerOwnedMetaAppWizard({ initialConnection, mode, selectedPhoneFromStatus });
  const isClosingDisabled =
    wizard.setupMutation.isPending ||
    wizard.selectMutation.isPending ||
    wizard.finalizeStage === "configuring" ||
    wizard.finalizeStage === "finalizing";

  return (
    <Card className="rounded-2xl border-border bg-white shadow-[0_18px_44px_-34px_oklch(0.2_0.04_155/0.45)]">
      <CardHeader className="gap-3 border-b border-border">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-xl font-semibold text-foreground">{setupTitle(mode)}</CardTitle>
            <CardDescription className="mt-2 max-w-2xl leading-6">
              Guided setup connects a WhatsApp number through a Meta App owned by your business.
            </CardDescription>
          </div>
          {onCancel ? (
            <Button className="min-h-11 w-full sm:w-auto" disabled={isClosingDisabled} onClick={onCancel} type="button" variant="outline">
              Close setup
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="grid gap-5 pt-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <CustomerOwnedMetaAppWizardStepper currentStep={wizard.currentStep} />
        <div className="min-w-0">
          {mode === "replace" ? (
            <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm leading-6 text-emerald-950">
              Your current WhatsApp connection will stay active until the new connection is completely ready.
            </p>
          ) : null}

          {initialConnection?.status === "ACTION_REQUIRED" || initialConnection?.status === "ERROR" ? (
            <p className="mb-4 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm leading-6 text-muted-foreground">
              {manualConnectionIssueMessage(initialConnection.issueCode)}
            </p>
          ) : null}

          {wizard.currentStep === "prepare" ? <CustomerOwnedMetaAppPrepareStep onReady={() => wizard.setCurrentStep("credentials")} /> : null}

          {wizard.currentStep === "credentials" ? (
            <CustomerOwnedMetaAppCredentialsStep
              error={wizard.stepError}
              isSubmitting={wizard.setupMutation.isPending || wizard.discoverMutation.isPending}
              onSubmit={(input) => wizard.setupMutation.mutate(input)}
            />
          ) : null}

          {wizard.currentStep === "number" ? (
            <div className="space-y-4">
              {!wizard.discovery && wizard.connectionId ? (
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Credentials are already stored securely. Resume setup by finding the WhatsApp accounts available to this Meta App.
                  </p>
                  <Button className="mt-3 min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" disabled={wizard.discoverMutation.isPending} onClick={wizard.resumeDiscovery} type="button">
                    {wizard.discoverMutation.isPending ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" />}
                    Resume setup
                  </Button>
                </div>
              ) : null}
              <CustomerOwnedMetaAppNumberStep
                discovery={wizard.discovery}
                error={wizard.stepError}
                isLoading={wizard.discoverMutation.isPending}
                isSelecting={wizard.selectMutation.isPending}
                onRefresh={wizard.resumeDiscovery}
                onSelect={(phone) => wizard.selectMutation.mutate(phone)}
              />
            </div>
          ) : null}

          {wizard.currentStep === "connection" ? (
            <CustomerOwnedMetaAppConnectionStep
              connectionLabel={wizard.selectedConnectionLabel}
              error={wizard.stepError}
              onDone={() => void onDone()}
              onRetry={() => void wizard.runActivation()}
              stage={wizard.finalizeStage}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
