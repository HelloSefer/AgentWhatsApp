"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  httpEmbeddedSignupCompletionService,
  manualConnectionIssueMessage,
  type CurrentWhatsAppConnection,
  type DiscoveredWhatsAppPhone,
  type ManualDiscoveryResult,
  type SafeManualSetup,
} from "../services/embedded-signup-completion-service";
import { whatsappConnectionErrorMessage } from "../utils/whatsapp-connection-error-message";
import { connectionStepFromStatus, selectedPhoneLabel, selectedPhoneSummary } from "./customer-owned-meta-app-wizard-view-models";
import {
  whatsappConnectionQueryKey,
  type CredentialsForm,
  type CustomerOwnedMetaAppWizardMode,
  type FinalizeStage,
  type WizardStep,
} from "./customer-owned-meta-app-wizard-types";

export function useCustomerOwnedMetaAppWizard({
  initialConnection,
  mode,
  selectedPhoneFromStatus,
}: Readonly<{
  initialConnection: CurrentWhatsAppConnection | null;
  mode: CustomerOwnedMetaAppWizardMode;
  selectedPhoneFromStatus: Pick<DiscoveredWhatsAppPhone, "maskedPhoneNumber" | "verifiedName"> | null;
}>) {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState<WizardStep>(() => (mode === "resume" ? connectionStepFromStatus(initialConnection) : "prepare"));
  const [safeSetup, setSafeSetup] = useState<SafeManualSetup | null>(() =>
    initialConnection?.connectionMethod === "CUSTOMER_OWNED_META_APP"
      ? {
          connectionId: initialConnection.connectionId,
          status: initialConnection.status,
          connectionMethod: initialConnection.connectionMethod,
          appId: "",
        }
      : null,
  );
  const [discovery, setDiscovery] = useState<ManualDiscoveryResult | null>(null);
  const [selectedPhone, setSelectedPhone] = useState<DiscoveredWhatsAppPhone | null>(null);
  const [stepError, setStepError] = useState<string | null>(initialConnection?.issueCode ? manualConnectionIssueMessage(initialConnection.issueCode) : null);
  const [finalizeStage, setFinalizeStage] = useState<FinalizeStage>("idle");

  const connectionId = safeSetup?.connectionId || initialConnection?.connectionId || "";
  const selectedConnectionLabel = selectedPhoneLabel(selectedPhone ?? selectedPhoneFromStatus);
  const selectedConnectionSummary = selectedPhoneSummary(selectedPhone ?? selectedPhoneFromStatus);

  const refreshCurrent = async () => {
    await queryClient.invalidateQueries({ queryKey: whatsappConnectionQueryKey });
  };

  const discoverMutation = useMutation({
    mutationFn: (id: string) => httpEmbeddedSignupCompletionService.discoverManual(id),
    onSuccess: async (result) => {
      setDiscovery(result);
      setStepError(null);
      await refreshCurrent();
    },
    onError: (error) => {
      setStepError(whatsappConnectionErrorMessage(error));
    },
  });

  const setupMutation = useMutation({
    mutationFn: (input: CredentialsForm) => httpEmbeddedSignupCompletionService.setupManual(input),
    onSuccess: async (setup) => {
      setSafeSetup(setup);
      setCurrentStep("number");
      setStepError(null);
      await refreshCurrent();
      discoverMutation.mutate(setup.connectionId);
      toast.success("Meta credentials verified.");
    },
    onError: (error) => {
      setStepError(whatsappConnectionErrorMessage(error));
    },
  });

  const selectMutation = useMutation({
    mutationFn: (phone: DiscoveredWhatsAppPhone) => {
      setSelectedPhone(phone);
      return httpEmbeddedSignupCompletionService.selectManualAssets({
        connectionId,
        wabaId: phone.wabaId,
        phoneNumberId: phone.phoneNumberId,
      });
    },
    onSuccess: async () => {
      setCurrentStep("connection");
      setFinalizeStage("idle");
      setStepError(null);
      await refreshCurrent();
      toast.success("WhatsApp number selected.");
    },
    onError: (error) => {
      setStepError(whatsappConnectionErrorMessage(error));
    },
  });

  const configureMutation = useMutation({
    mutationFn: (id: string) => httpEmbeddedSignupCompletionService.configureManualWebhook(id),
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: string) => httpEmbeddedSignupCompletionService.finalizeManual(id),
  });

  const resumeDiscovery = () => {
    if (!connectionId || discoverMutation.isPending) return;
    setCurrentStep("number");
    discoverMutation.mutate(connectionId);
  };

  const runActivation = async () => {
    if (!connectionId || finalizeStage === "configuring" || finalizeStage === "finalizing") return;

    setStepError(null);
    setFinalizeStage("configuring");

    try {
      await configureMutation.mutateAsync(connectionId);
      await refreshCurrent();
      setFinalizeStage("configured");
    } catch (error) {
      setFinalizeStage("error");
      setStepError(whatsappConnectionErrorMessage(error));
      return;
    }

    setFinalizeStage("finalizing");

    try {
      await finalizeMutation.mutateAsync(connectionId);
      await refreshCurrent();
      setFinalizeStage("done");
      toast.success("WhatsApp connected.");
    } catch (error) {
      setFinalizeStage("error");
      setStepError(whatsappConnectionErrorMessage(error));
    }
  };

  return {
    connectionId,
    currentStep,
    discovery,
    discoverMutation,
    finalizeStage,
    resumeDiscovery,
    runActivation,
    selectedConnectionLabel,
    selectedConnectionSummary,
    selectMutation,
    setCurrentStep,
    setupMutation,
    stepError,
  };
}
