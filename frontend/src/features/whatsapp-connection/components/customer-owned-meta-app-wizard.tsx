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
  const canGoBack =
    !isClosingDisabled &&
    wizard.finalizeStage !== "done" &&
    (wizard.currentStep === "credentials" || wizard.currentStep === "number" || wizard.currentStep === "connection");
  const goBack = () => {
    if (!canGoBack) return;
    if (wizard.currentStep === "credentials") wizard.setCurrentStep("prepare");
    if (wizard.currentStep === "number") wizard.setCurrentStep("credentials");
    if (wizard.currentStep === "connection") wizard.setCurrentStep("number");
  };

  return (
    <Card className="mx-auto max-w-[1120px] rounded-xl border-marketing-border bg-white shadow-[0_14px_34px_-34px_oklch(0.2_0.04_155/0.42)]">
      <CardHeader className="gap-3 border-b border-marketing-border px-4 py-3.5 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-lg font-semibold text-foreground" id="whatsapp-guided-setup-heading">{setupTitle(mode)}</CardTitle>
            <CardDescription className="mt-1.5 max-w-2xl leading-6">
              Connect a WhatsApp Business number through an App owned by your business.
            </CardDescription>
          </div>
          {onCancel ? (
            <Button className="min-h-11 w-full sm:w-auto" disabled={isClosingDisabled} onClick={onCancel} type="button" variant="ghost">
              Close setup
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[205px_minmax(0,1fr)]">
        <div className="lg:border-r lg:border-marketing-border lg:pr-4">
          <CustomerOwnedMetaAppWizardStepper currentStep={wizard.currentStep} />
        </div>
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
              onBack={goBack}
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
                onBack={goBack}
                onRefresh={wizard.resumeDiscovery}
                onSelect={(phone) => wizard.selectMutation.mutate(phone)}
              />
            </div>
          ) : null}

          {wizard.currentStep === "connection" ? (
            <CustomerOwnedMetaAppConnectionStep
              connectionLabel={wizard.selectedConnectionLabel}
              connectionSummary={wizard.selectedConnectionSummary}
              error={wizard.stepError}
              onBack={goBack}
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
