"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { agentShowcaseAnimationConfig } from "../config/agent-showcase-animation-config";
import { useAgentShowcaseWorkflow } from "../hooks/use-agent-showcase-workflow";
import { AgentShowcaseMessageThread } from "./agent-showcase-message-thread";
import { AgentShowcaseOrderCard } from "./agent-showcase-order-card";
import { AgentShowcaseStage } from "./agent-showcase-stage";

const AgentShowcaseRive = dynamic(() => import("./agent-showcase-rive").then((module) => module.AgentShowcaseRive), { ssr: false });
const visualBreakpointQuery = "(min-width: 768px)";

type RiveStatus = "failed" | "loading" | "ready";

function subscribeToVisualBreakpoint(callback: () => void) {
  const mediaQuery = window.matchMedia(visualBreakpointQuery);
  mediaQuery.addEventListener("change", callback);

  return () => mediaQuery.removeEventListener("change", callback);
}

function getVisualBreakpointSnapshot() {
  return window.matchMedia(visualBreakpointQuery).matches;
}

function getVisualBreakpointServerSnapshot() {
  return false;
}

export function AgentShowcaseAnimation() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const [riveStatus, setRiveStatus] = useState<RiveStatus>("loading");
  const shouldRenderVisual = useSyncExternalStore(subscribeToVisualBreakpoint, getVisualBreakpointSnapshot, getVisualBreakpointServerSnapshot);
  const isInView = useInView(sceneRef, { amount: 0.2 });
  const shouldReduceMotion = Boolean(useReducedMotion());
  const isActive = shouldRenderVisual && isInView && !shouldReduceMotion;
  const workflow = useAgentShowcaseWorkflow({ isActive, shouldReduceMotion });
  const handleRiveReady = useCallback(() => setRiveStatus("ready"), []);
  const handleRiveError = useCallback(() => setRiveStatus("failed"), []);

  const messageThread = (
    <AgentShowcaseMessageThread
      isSettling={workflow.isSettling}
      isTyping={workflow.isTyping}
      messages={workflow.visibleMessages}
      shouldReduceMotion={shouldReduceMotion}
    />
  );

  const rive = (
    <>
      {shouldRenderVisual && riveStatus === "loading" ? (
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          <motion.span
            animate={shouldReduceMotion ? { opacity: 0.3 } : { opacity: [0.22, 0.48, 0.22] }}
            className="h-px w-16 rounded-full bg-marketing-primary/30"
            transition={shouldReduceMotion ? { duration: 0 } : { duration: agentShowcaseAnimationConfig.motion.typingDot, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }}
          />
        </div>
      ) : null}
      <motion.div
        animate={{ opacity: riveStatus === "ready" ? 1 : 0 }}
        className="size-full"
        transition={{ duration: shouldReduceMotion ? 0 : agentShowcaseAnimationConfig.motion.riveFade, ease: "easeOut" }}
      >
        {shouldRenderVisual && riveStatus !== "failed" ? (
          <AgentShowcaseRive
            isActive={isActive}
            onError={handleRiveError}
            onReady={handleRiveReady}
            trigger={workflow.riveTrigger}
          />
        ) : null}
      </motion.div>
    </>
  );

  const orderCard = (
    <AgentShowcaseOrderCard
      fields={workflow.orderFields}
      isConfirmed={workflow.isConfirmed}
      isSettling={workflow.isSettling}
      shouldReduceMotion={shouldReduceMotion}
    />
  );

  return <AgentShowcaseStage isActive={isActive} messageThread={messageThread} orderCard={orderCard} rive={rive} sceneRef={sceneRef} />;
}
