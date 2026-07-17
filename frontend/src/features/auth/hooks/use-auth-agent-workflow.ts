"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authAgentChatMessages,
  authAgentOrderFields,
  authAgentWorkflow,
  type ChatMessage,
  type OrderFieldState,
  type RiveTriggerName,
  type WorkflowPhase,
} from "../config/auth-agent-animation-config";

export type RiveTriggerEvent = Readonly<{
  name: RiveTriggerName;
  sequence: number;
}>;

type AuthAgentWorkflowOptions = Readonly<{
  isActive: boolean;
  shouldReduceMotion: boolean;
}>;

type WorkflowPosition = Readonly<{
  index: number;
  sequence: number;
}>;

export type AuthAgentWorkflowState = Readonly<{
  isConfirmed: boolean;
  isSettling: boolean;
  isTyping: boolean;
  orderFields: readonly OrderFieldState[];
  phase: WorkflowPhase;
  riveTrigger: RiveTriggerEvent | null;
  visibleMessages: readonly ChatMessage[];
}>;

const initialPosition: WorkflowPosition = { index: 0, sequence: 0 };

export function useAuthAgentWorkflow({ isActive, shouldReduceMotion }: AuthAgentWorkflowOptions): AuthAgentWorkflowState {
  const [position, setPosition] = useState<WorkflowPosition>(initialPosition);
  const isMountedRef = useRef(false);
  const phaseStartedAtRef = useRef<number | null>(null);
  const remainingDurationRef = useRef<number>(authAgentWorkflow[0].durationMs);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pauseCurrentStep = useCallback(() => {
    if (phaseStartedAtRef.current !== null) {
      const elapsed = Date.now() - phaseStartedAtRef.current;
      remainingDurationRef.current = Math.max(0, remainingDurationRef.current - elapsed);
      phaseStartedAtRef.current = null;
    }

    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      pauseCurrentStep();
    };
  }, [pauseCurrentStep]);

  useEffect(() => {
    if (shouldReduceMotion || !isActive || timeoutRef.current !== null) {
      pauseCurrentStep();
      return;
    }

    const step = authAgentWorkflow[position.index];
    const duration = remainingDurationRef.current || step.durationMs;
    remainingDurationRef.current = duration;
    phaseStartedAtRef.current = Date.now();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      phaseStartedAtRef.current = null;

      if (!isMountedRef.current) {
        return;
      }

      setPosition((currentPosition) => {
        const nextIndex = (currentPosition.index + 1) % authAgentWorkflow.length;
        remainingDurationRef.current = authAgentWorkflow[nextIndex].durationMs;

        return { index: nextIndex, sequence: currentPosition.sequence + 1 };
      });
    }, duration);

    return pauseCurrentStep;
  }, [isActive, pauseCurrentStep, position.index, shouldReduceMotion]);

  return useMemo(() => {
    const step = shouldReduceMotion ? authAgentWorkflow.find((item) => item.phase === "confirmed")! : authAgentWorkflow[position.index];
    const visibleMessages = authAgentChatMessages.filter((message) => step.visibleMessageIds.includes(message.id));
    const orderFields = authAgentOrderFields.map<OrderFieldState>((field) => ({
      ...field,
      status: step.validatedOrderFields.includes(field.field)
        ? "validated"
        : step.visibleOrderFields.includes(field.field)
          ? "visible"
          : "hidden",
    }));

    return {
      isConfirmed: step.confirmationVisible,
      isSettling: step.phase === "settle",
      isTyping: shouldReduceMotion ? false : step.typingVisible,
      orderFields,
      phase: step.phase,
      riveTrigger:
        shouldReduceMotion || !step.riveTrigger
          ? null
          : { name: step.riveTrigger, sequence: position.sequence },
      visibleMessages,
    };
  }, [position, shouldReduceMotion]);
}
