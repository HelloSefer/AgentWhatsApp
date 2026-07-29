"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    wizard.discoverMutation.isPending ||
    wizard.selectMutation.isPending ||
    wizard.finalizeStage === "configuring" ||
    wizard.finalizeStage === "finalizing";
  const goBackToPrepare = () => {
    if (isClosingDisabled || wizard.currentStep !== "credentials") return;
    wizard.setCurrentStep("prepare");
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

          {wizard.currentStep === "prepare" && wizard.stepError ? (
            <p className="mb-4 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm leading-6 text-muted-foreground">
              {wizard.stepError}
            </p>
          ) : null}

          {wizard.currentStep === "prepare" ? <CustomerOwnedMetaAppPrepareStep onReady={() => wizard.setCurrentStep("credentials")} /> : null}

          {wizard.currentStep === "credentials" ? (
            <CustomerOwnedMetaAppCredentialsStep
              error={wizard.stepError}
              isSubmitting={wizard.setupMutation.isPending}
              onBack={goBackToPrepare}
              onSubmit={(input) => wizard.setupMutation.mutate(input)}
            />
          ) : null}

          {wizard.currentStep === "number" ? (
            <CustomerOwnedMetaAppNumberStep
              discovery={wizard.discovery}
              error={wizard.stepError}
              isLoading={wizard.discoverMutation.isPending}
              isSelecting={wizard.selectMutation.isPending}
              onRefresh={wizard.resumeDiscovery}
              onSelect={wizard.selectAssets}
              onUpdateCredentials={wizard.beginCredentialUpdate}
              onVerifyManual={wizard.selectAssets}
              requiresManualAssetEntry={wizard.requiresManualAssetEntry}
            />
          ) : null}

          {wizard.currentStep === "connection" ? (
            <CustomerOwnedMetaAppConnectionStep
              connectionLabel={wizard.selectedConnectionLabel}
              connectionSummary={wizard.selectedConnectionSummary}
              error={wizard.stepError}
              onDone={() => void onDone()}
              onRetry={() => void wizard.runActivation()}
              onUpdateCredentials={wizard.beginCredentialUpdate}
              stage={wizard.finalizeStage}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
