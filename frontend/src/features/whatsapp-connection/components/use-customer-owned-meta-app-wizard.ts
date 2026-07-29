"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  httpEmbeddedSignupCompletionService,
  manualConnectionIssueMessage,
  EmbeddedSignupCompletionServiceError,
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
  const [credentialUpdateConnectionId, setCredentialUpdateConnectionId] = useState<string | null>(() =>
    mode === "resume" && initialConnection?.connectionMethod === "CUSTOMER_OWNED_META_APP"
      ? initialConnection.connectionId
      : null,
  );
  const [setupSingleFlight, setSetupSingleFlight] = useState(false);
  const [setupRetryBlocked, setSetupRetryBlocked] = useState(false);
  const setupSingleFlightRef = useRef(false);
  const setupRetryBlockedRef = useRef(false);
  const setupRetryTimeoutRef = useRef<number | null>(null);
  const discoverSingleFlightRef = useRef(false);
  const selectSingleFlightRef = useRef(false);
  const activationSingleFlightRef = useRef(false);

  const connectionId = safeSetup?.connectionId || initialConnection?.connectionId || "";
  const selectedConnectionLabel = selectedPhoneLabel(selectedPhone ?? selectedPhoneFromStatus);
  const selectedConnectionSummary = selectedPhoneSummary(selectedPhone ?? selectedPhoneFromStatus);

  const refreshCurrent = async () => {
    await queryClient.invalidateQueries({ queryKey: whatsappConnectionQueryKey });
  };

  useEffect(() => {
    return () => {
      setupRetryBlockedRef.current = false;
      discoverSingleFlightRef.current = false;
      selectSingleFlightRef.current = false;
      activationSingleFlightRef.current = false;
      if (setupRetryTimeoutRef.current !== null) window.clearTimeout(setupRetryTimeoutRef.current);
    };
  }, []);

  const discoverMutation = useMutation({
    mutationFn: (id: string) => httpEmbeddedSignupCompletionService.discoverManual(id),
    retry: false,
    onSuccess: async (result) => {
      setDiscovery(result);
      setStepError(null);
      await refreshCurrent();
    },
    onError: (error) => {
      setStepError(whatsappConnectionErrorMessage(error));
    },
    onSettled: () => {
      discoverSingleFlightRef.current = false;
    },
  });
  const startDiscovery = useCallback((id: string) => {
    if (!id || discoverSingleFlightRef.current) return;
    discoverSingleFlightRef.current = true;
    setStepError(null);
    setDiscovery(null);
    setSelectedPhone(null);
    setFinalizeStage("idle");
    discoverMutation.reset();
    discoverMutation.mutate(id);
  }, [discoverMutation]);
  const requiresManualAssetEntry =
    !discoverMutation.isPending &&
    discoverMutation.error instanceof EmbeddedSignupCompletionServiceError &&
    discoverMutation.error.code === "META_ASSET_DISCOVERY_FAILED";

  const selectMutation = useMutation({
    mutationFn: (phone: Pick<DiscoveredWhatsAppPhone, "wabaId" | "phoneNumberId">) => {
      return httpEmbeddedSignupCompletionService.selectManualAssets({
        connectionId,
        wabaId: phone.wabaId,
        phoneNumberId: phone.phoneNumberId,
      });
    },
    retry: false,
    onSuccess: async (result, phone) => {
      setSelectedPhone({
        wabaId: phone.wabaId,
        phoneNumberId: phone.phoneNumberId,
        maskedPhoneNumber: result.connection?.maskedPhoneNumber ?? null,
        verifiedName: result.connection?.verifiedName ?? null,
        status: null,
        verificationStatus: null,
      });
      setFinalizeStage("idle");
      setStepError(null);
      await refreshCurrent();
      setCurrentStep("connection");
      toast.success("WhatsApp number selected.");
    },
    onError: (error) => {
      setStepError(whatsappConnectionErrorMessage(error));
    },
    onSettled: () => {
      selectSingleFlightRef.current = false;
    },
  });
  const selectAssets = useCallback((phone: Pick<DiscoveredWhatsAppPhone, "wabaId" | "phoneNumberId">) => {
    if (!connectionId || selectSingleFlightRef.current) return;
    selectSingleFlightRef.current = true;
    setStepError(null);
    setSelectedPhone(null);
    setFinalizeStage("idle");
    selectMutation.reset();
    selectMutation.mutate(phone);
  }, [connectionId, selectMutation]);

  const setupMutation = useMutation({
    mutationFn: (input: CredentialsForm) => {
      const updateConnectionId = credentialUpdateConnectionId ?? (mode === "resume" ? connectionId : "");
      return httpEmbeddedSignupCompletionService.setupManual({
        ...input,
        ...(updateConnectionId ? { connectionId: updateConnectionId } : {}),
      });
    },
    retry: false,
    onSuccess: async (setup) => {
      discoverSingleFlightRef.current = false;
      selectSingleFlightRef.current = false;
      discoverMutation.reset();
      selectMutation.reset();
      setSafeSetup(setup);
      setCredentialUpdateConnectionId(setup.connectionId);
      setDiscovery(null);
      setSelectedPhone(null);
      setFinalizeStage("idle");
      setCurrentStep("number");
      setStepError(null);
      toast.success("Meta credentials verified.");
      startDiscovery(setup.connectionId);
      await refreshCurrent();
    },
    onError: (error) => {
      if (error instanceof EmbeddedSignupCompletionServiceError && error.code === "RATE_LIMITED" && error.retryAfterSeconds) {
        setupRetryBlockedRef.current = true;
        setSetupRetryBlocked(true);
        if (setupRetryTimeoutRef.current !== null) window.clearTimeout(setupRetryTimeoutRef.current);
        setupRetryTimeoutRef.current = window.setTimeout(() => {
          setupRetryBlockedRef.current = false;
          setSetupRetryBlocked(false);
          setupRetryTimeoutRef.current = null;
        }, error.retryAfterSeconds * 1000);
      }
      setStepError(whatsappConnectionErrorMessage(error));
    },
    onSettled: () => {
      setupSingleFlightRef.current = false;
      setSetupSingleFlight(false);
    },
  });

  const submitCredentials = useCallback((input: CredentialsForm) => {
    if (setupSingleFlightRef.current || setupRetryBlockedRef.current) return;
    setupSingleFlightRef.current = true;
    setSetupSingleFlight(true);
    setStepError(null);
    setupMutation.mutate(input);
  }, [setupMutation]);
  const guardedSetupMutation = useMemo(
    () => ({
      ...setupMutation,
      isPending: setupMutation.isPending || setupSingleFlight || setupRetryBlocked,
      mutate: submitCredentials,
    }),
    [setupMutation, setupRetryBlocked, setupSingleFlight, submitCredentials],
  );

  const configureMutation = useMutation({
    mutationFn: (id: string) => httpEmbeddedSignupCompletionService.configureManualWebhook(id),
    retry: false,
  });

  const finalizeMutation = useMutation({
    mutationFn: (id: string) => httpEmbeddedSignupCompletionService.finalizeManual(id),
    retry: false,
  });

  const resumeDiscovery = useCallback(() => {
    if (!connectionId) return;
    setCurrentStep("number");
    startDiscovery(connectionId);
  }, [connectionId, startDiscovery]);

  const beginCredentialUpdate = useCallback(() => {
    if (
      !connectionId ||
      setupSingleFlightRef.current ||
      discoverSingleFlightRef.current ||
      selectSingleFlightRef.current ||
      activationSingleFlightRef.current
    ) {
      return;
    }
    setCredentialUpdateConnectionId(connectionId);
    setDiscovery(null);
    setSelectedPhone(null);
    setFinalizeStage("idle");
    setStepError(null);
    discoverMutation.reset();
    selectMutation.reset();
    setCurrentStep("credentials");
  }, [connectionId, discoverMutation, selectMutation]);

  const runActivation = async () => {
    if (!connectionId || activationSingleFlightRef.current) return;

    activationSingleFlightRef.current = true;
    setStepError(null);
    setFinalizeStage("configuring");

    try {
      await configureMutation.mutateAsync(connectionId);
      await refreshCurrent();
      setFinalizeStage("configured");
      setFinalizeStage("finalizing");
      await finalizeMutation.mutateAsync(connectionId);
      await refreshCurrent();
      setFinalizeStage("done");
      toast.success("WhatsApp connected.");
    } catch (error) {
      setFinalizeStage("error");
      setStepError(whatsappConnectionErrorMessage(error));
    } finally {
      activationSingleFlightRef.current = false;
    }
  };

  return {
    connectionId,
    currentStep,
    beginCredentialUpdate,
    discovery,
    discoverMutation,
    finalizeStage,
    resumeDiscovery,
    requiresManualAssetEntry,
    runActivation,
    selectedConnectionLabel,
    selectedConnectionSummary,
    selectAssets,
    selectMutation,
    setCurrentStep,
    setupMutation: guardedSetupMutation,
    stepError,
  };
}
