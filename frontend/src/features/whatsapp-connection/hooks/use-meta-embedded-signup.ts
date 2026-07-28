"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MetaEmbeddedSignupConfigState } from "../config/meta-embedded-signup-config";
import { loadFacebookSdk } from "../lib/facebook-sdk-loader";
import { parseEmbeddedSignupMessageEvent, type EmbeddedSignupCompletionAssets } from "../lib/embedded-signup-events";
import {
  httpEmbeddedSignupCompletionService,
  type EmbeddedSignupCompletionService,
} from "../services/embedded-signup-completion-service";
import type { FacebookLoginResponse } from "../types/facebook-sdk";
import { whatsappConnectionErrorMessage } from "../utils/whatsapp-connection-error-message";

export type EmbeddedSignupUiStatus =
  | "idle"
  | "not_configured"
  | "launching"
  | "waiting_for_meta"
  | "finalizing"
  | "cancelled"
  | "error"
  | "verified";

type UseMetaEmbeddedSignupInput = Readonly<{
  configState: MetaEmbeddedSignupConfigState;
  completionService?: EmbeddedSignupCompletionService;
  onCompleted?: () => void | Promise<void>;
}>;

type PendingCompletion = Readonly<{
  code: string | null;
  assets: EmbeddedSignupCompletionAssets | null;
}>;

const EMPTY_PENDING_COMPLETION: PendingCompletion = { code: null, assets: null };

function codeFromLoginResponse(response: FacebookLoginResponse): string | null {
  const code = response.authResponse?.code;
  return typeof code === "string" && code.trim().length > 0 ? code.trim() : null;
}

function sameAssets(left: EmbeddedSignupCompletionAssets | null, right: EmbeddedSignupCompletionAssets): boolean {
  return Boolean(left && left.wabaId === right.wabaId && left.phoneNumberId === right.phoneNumberId);
}

export function useMetaEmbeddedSignup({
  configState,
  completionService = httpEmbeddedSignupCompletionService,
  onCompleted,
}: UseMetaEmbeddedSignupInput) {
  const [status, setStatus] = useState<EmbeddedSignupUiStatus>(configState.isConfigured ? "idle" : "not_configured");
  const [message, setMessage] = useState<string | null>(null);
  const pendingRef = useRef<PendingCompletion>(EMPTY_PENDING_COMPLETION);
  const completionSubmittedRef = useRef(false);
  const mountedRef = useRef(false);

  const resetFlowState = useCallback(() => {
    pendingRef.current = EMPTY_PENDING_COMPLETION;
    completionSubmittedRef.current = false;
  }, []);

  const completeWhenReady = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending.code || !pending.assets || completionSubmittedRef.current) return;

    completionSubmittedRef.current = true;
    setStatus("finalizing");
    setMessage("Verifying the connection with AgentWhatsApp.");

    try {
      const response = await completionService.complete({
        code: pending.code,
        wabaId: pending.assets.wabaId,
        phoneNumberId: pending.assets.phoneNumberId,
      });

      if (!mountedRef.current) return;

      if (response.success) {
        setStatus("verified");
        setMessage("WhatsApp connection verified.");
        await onCompleted?.();
        return;
      }

      completionSubmittedRef.current = false;
      setStatus("error");
      setMessage("WhatsApp connection was not verified. Please try again.");
    } catch (error) {
      if (!mountedRef.current) return;
      completionSubmittedRef.current = false;
      setStatus("error");
      setMessage(whatsappConnectionErrorMessage(error));
    }
  }, [completionService, onCompleted]);

  const handleLoginResponse = useCallback(
    (response: FacebookLoginResponse) => {
      const code = codeFromLoginResponse(response);
      if (!code) {
        if (completionSubmittedRef.current) return;
        setStatus("cancelled");
        setMessage("WhatsApp connection was cancelled before verification.");
        return;
      }

      pendingRef.current = { ...pendingRef.current, code };
      setStatus("waiting_for_meta");
      setMessage("Waiting for Meta to finish the signup handoff.");
      void completeWhenReady();
    },
    [completeWhenReady],
  );

  const launch = useCallback(async () => {
    if (!configState.isConfigured) {
      setStatus("not_configured");
      setMessage("WhatsApp connection is not configured yet.");
      return;
    }

    if (status === "launching" || status === "waiting_for_meta" || status === "finalizing") return;

    resetFlowState();
    setStatus("launching");
    setMessage("Opening Meta Embedded Signup.");

    try {
      const sdk = await loadFacebookSdk({
        appId: configState.config.appId,
        graphApiVersion: configState.config.graphApiVersion,
      });

      sdk.login(handleLoginResponse, {
        config_id: configState.config.configurationId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
        },
      });
    } catch {
      setStatus("error");
      setMessage("Meta signup could not be opened. Please allow popups and try again.");
    }
  }, [configState, handleLoginResponse, resetFlowState, status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent<unknown>) {
      const parsed = parseEmbeddedSignupMessageEvent(event);
      if (!parsed || completionSubmittedRef.current) return;

      if (parsed.kind === "finish") {
        if (sameAssets(pendingRef.current.assets, parsed.assets)) return;
        pendingRef.current = { ...pendingRef.current, assets: parsed.assets };
        setStatus("waiting_for_meta");
        setMessage("Meta signup finished. Verifying the connection.");
        void completeWhenReady();
        return;
      }

      if (parsed.kind === "cancel") {
        resetFlowState();
        setStatus("cancelled");
        setMessage("WhatsApp connection was cancelled.");
        return;
      }

      resetFlowState();
      setStatus("error");
      setMessage("Meta reported that WhatsApp signup could not be completed.");
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [completeWhenReady, resetFlowState]);

  const isBusy = status === "launching" || status === "waiting_for_meta" || status === "finalizing";
  const canLaunch = configState.isConfigured && !isBusy;

  return useMemo(
    () => ({
      status,
      message,
      canLaunch,
      isBusy,
      launch,
    }),
    [canLaunch, isBusy, launch, message, status],
  );
}
