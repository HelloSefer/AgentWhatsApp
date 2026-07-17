"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alignment, Fit, Layout, useRive, useStateMachineInput } from "@rive-app/react-webgl2";
import type { RiveTriggerEvent } from "../hooks/use-auth-agent-workflow";

const riveSource = "/animations/auth/agentwhatsapp-bot.riv";
const riveArtboard = "Artboard";
const riveStateMachine = "State Machine 1";

type AuthAgentRiveProps = Readonly<{
  isActive: boolean;
  onError: () => void;
  onReady: () => void;
  trigger: RiveTriggerEvent | null;
}>;

export function AuthAgentRive({ isActive, onError, onReady, trigger }: AuthAgentRiveProps) {
  const [hasFailed, setHasFailed] = useState(false);
  const hasFiredInitialBounceRef = useRef(false);
  const hasReportedReadyRef = useRef(false);
  const hasReportedErrorRef = useRef(false);
  const lastFiredTriggerRef = useRef(-1);
  const layout = useMemo(() => new Layout({ alignment: Alignment.Center, fit: Fit.Contain }), []);

  const reportReady = useCallback(() => {
    if (hasReportedReadyRef.current || hasFailed) {
      return;
    }

    hasReportedReadyRef.current = true;
    onReady();
  }, [hasFailed, onReady]);

  const reportError = useCallback(() => {
    if (hasReportedErrorRef.current) {
      return;
    }

    hasReportedErrorRef.current = true;
    setHasFailed(true);
    onError();
  }, [onError]);

  const riveParameters = useMemo(
    () => ({
      artboard: riveArtboard,
      autoplay: true,
      layout,
      onLoad: reportReady,
      onLoadError: reportError,
      onRiveReady: reportReady,
      shouldDisableRiveListeners: true,
      src: riveSource,
      stateMachines: riveStateMachine,
    }),
    [layout, reportError, reportReady],
  );

  const { RiveComponent, rive } = useRive(riveParameters, { shouldResizeCanvasToContainer: true });
  const thinkInput = useStateMachineInput(rive, riveStateMachine, "think");
  const typeInput = useStateMachineInput(rive, riveStateMachine, "type");
  const bounceInput = useStateMachineInput(rive, riveStateMachine, "bounce");

  useEffect(() => {
    if (!rive || hasFailed) {
      return;
    }

    try {
      if (isActive) {
        rive.play(riveStateMachine);
      } else {
        rive.pause(riveStateMachine);
      }
    } catch {
      reportError();
    }
  }, [hasFailed, isActive, reportError, rive]);

  useEffect(() => {
    if (!isActive || !bounceInput || hasFiredInitialBounceRef.current || hasFailed) {
      return;
    }

    try {
      bounceInput.fire();
      hasFiredInitialBounceRef.current = true;
    } catch {
      reportError();
    }
  }, [bounceInput, hasFailed, isActive, reportError]);

  useEffect(() => {
    if (!trigger || trigger.sequence === lastFiredTriggerRef.current || hasFailed) {
      return;
    }

    const input = {
      bounce: bounceInput,
      think: thinkInput,
      type: typeInput,
    }[trigger.name];

    if (!input) {
      return;
    }

    try {
      input.fire();
      lastFiredTriggerRef.current = trigger.sequence;
    } catch {
      reportError();
    }
  }, [bounceInput, hasFailed, reportError, thinkInput, trigger, typeInput]);

  if (hasFailed) {
    return null;
  }

  return <RiveComponent aria-hidden="true" className="pointer-events-none size-full" tabIndex={-1} />;
}
