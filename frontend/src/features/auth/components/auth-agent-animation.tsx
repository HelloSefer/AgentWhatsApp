"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { authAgentAnimationConfig } from "../config/auth-agent-animation-config";
import { useAuthAgentWorkflow } from "../hooks/use-auth-agent-workflow";
import { AuthAgentMessageThread } from "./auth-agent-message-thread";
import { AuthAgentOrderCard } from "./auth-agent-order-card";

const AuthAgentRive = dynamic(() => import("./auth-agent-rive").then((module) => module.AuthAgentRive), { ssr: false });
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

export function AuthAgentAnimation() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const [riveStatus, setRiveStatus] = useState<RiveStatus>("loading");
  const shouldRenderVisual = useSyncExternalStore(subscribeToVisualBreakpoint, getVisualBreakpointSnapshot, getVisualBreakpointServerSnapshot);
  const isInView = useInView(sceneRef, { amount: 0.2 });
  const shouldReduceMotion = Boolean(useReducedMotion());
  const isActive = shouldRenderVisual && isInView && !shouldReduceMotion;
  const workflow = useAuthAgentWorkflow({ isActive, shouldReduceMotion });
  const handleRiveReady = useCallback(() => setRiveStatus("ready"), []);
  const handleRiveError = useCallback(() => setRiveStatus("failed"), []);

  return (
    <div className="relative aspect-[4/3] w-full overflow-visible" ref={sceneRef}>
      <div aria-hidden="true" className="pointer-events-none absolute top-[16%] left-[29%] h-[58%] w-[42%] rounded-full bg-[radial-gradient(circle,rgba(201,239,211,0.78)_0%,rgba(234,247,237,0.34)_55%,transparent_76%)]" />

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden sm:block">
        {[
          [16, 72],
          [28, 18],
          [61, 14],
          [88, 25],
          [94, 78],
        ].map(([left, top], index) => (
          <motion.span
            animate={isActive ? { opacity: [0.2, 0.58, 0.2], y: [0, -4, 0] } : { opacity: 0.3, y: 0 }}
            className="absolute size-1 rounded-full bg-[#75a987]"
            key={`${left}-${top}`}
            style={{ left: `${left}%`, top: `${top}%` }}
            transition={
              isActive
                ? {
                    delay: index * authAgentAnimationConfig.motion.particleDelay,
                    duration: authAgentAnimationConfig.motion.particleDuration,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                  }
                : { duration: 0 }
            }
          />
        ))}
      </div>

      <div className="absolute top-[1%] left-0 h-[98%] w-[35%] min-w-0">
        <AuthAgentMessageThread
          isSettling={workflow.isSettling}
          isTyping={workflow.isTyping}
          messages={workflow.visibleMessages}
          shouldReduceMotion={shouldReduceMotion}
        />
      </div>

      <div className="absolute top-[8%] left-[35%] h-[80%] w-[31%]">
        {shouldRenderVisual && riveStatus === "loading" ? (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <motion.span
              animate={shouldReduceMotion ? { opacity: 0.3 } : { opacity: [0.22, 0.48, 0.22] }}
              className="h-px w-16 rounded-full bg-marketing-primary/30"
              transition={shouldReduceMotion ? { duration: 0 } : { duration: authAgentAnimationConfig.motion.typingDot, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }}
            />
          </div>
        ) : null}
        <motion.div
          animate={{ opacity: riveStatus === "ready" ? 1 : 0 }}
          className="size-full"
          transition={{ duration: shouldReduceMotion ? 0 : authAgentAnimationConfig.motion.riveFade, ease: "easeOut" }}
        >
          {shouldRenderVisual && riveStatus !== "failed" ? (
            <AuthAgentRive
              isActive={isActive}
              onError={handleRiveError}
              onReady={handleRiveReady}
              trigger={workflow.riveTrigger}
            />
          ) : null}
        </motion.div>
      </div>

      <div className="absolute top-[23%] right-0 w-[29%] min-w-0">
        <AuthAgentOrderCard
          fields={workflow.orderFields}
          isConfirmed={workflow.isConfirmed}
          isSettling={workflow.isSettling}
          shouldReduceMotion={shouldReduceMotion}
        />
      </div>
    </div>
  );
}
