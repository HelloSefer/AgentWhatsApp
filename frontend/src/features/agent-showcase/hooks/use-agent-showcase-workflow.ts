"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentShowcaseChatMessages,
  agentShowcaseOrderFields,
  agentShowcaseWorkflow,
  type ChatMessage,
  type OrderFieldState,
  type RiveTriggerName,
  type WorkflowPhase,
} from "../config/agent-showcase-animation-config";

export type RiveTriggerEvent = Readonly<{
  name: RiveTriggerName;
  sequence: number;
}>;

type AgentShowcaseWorkflowOptions = Readonly<{
  isActive: boolean;
  shouldReduceMotion: boolean;
}>;

type WorkflowPosition = Readonly<{
  index: number;
  sequence: number;
}>;

export type AgentShowcaseWorkflowState = Readonly<{
  isConfirmed: boolean;
  isSettling: boolean;
  isTyping: boolean;
  orderFields: readonly OrderFieldState[];
  phase: WorkflowPhase;
  riveTrigger: RiveTriggerEvent | null;
  visibleMessages: readonly ChatMessage[];
}>;

const initialPosition: WorkflowPosition = { index: 0, sequence: 0 };

export function useAgentShowcaseWorkflow({ isActive, shouldReduceMotion }: AgentShowcaseWorkflowOptions): AgentShowcaseWorkflowState {
  const [position, setPosition] = useState<WorkflowPosition>(initialPosition);
  const isMountedRef = useRef(false);
  const phaseStartedAtRef = useRef<number | null>(null);
  const remainingDurationRef = useRef<number>(agentShowcaseWorkflow[0].durationMs);
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

    const step = agentShowcaseWorkflow[position.index];
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
        const nextIndex = (currentPosition.index + 1) % agentShowcaseWorkflow.length;
        remainingDurationRef.current = agentShowcaseWorkflow[nextIndex].durationMs;

        return { index: nextIndex, sequence: currentPosition.sequence + 1 };
      });
    }, duration);

    return pauseCurrentStep;
  }, [isActive, pauseCurrentStep, position.index, shouldReduceMotion]);

  return useMemo(() => {
    const step = shouldReduceMotion ? agentShowcaseWorkflow.find((item) => item.phase === "confirmed")! : agentShowcaseWorkflow[position.index];
    const visibleMessages = agentShowcaseChatMessages.filter((message) => step.visibleMessageIds.includes(message.id));
    const orderFields = agentShowcaseOrderFields.map<OrderFieldState>((field) => ({
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
