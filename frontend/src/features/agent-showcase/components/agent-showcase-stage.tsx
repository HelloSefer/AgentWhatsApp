"use client";

import type { ReactNode, RefObject } from "react";
import { motion } from "motion/react";
import { agentShowcaseAnimationConfig } from "../config/agent-showcase-animation-config";

type AgentShowcaseStageProps = Readonly<{
  isActive: boolean;
  messageThread: ReactNode;
  orderCard: ReactNode;
  rive: ReactNode;
  sceneRef: RefObject<HTMLDivElement | null>;
}>;

export function AgentShowcaseStage({ isActive, messageThread, orderCard, rive, sceneRef }: AgentShowcaseStageProps) {
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
                    delay: index * agentShowcaseAnimationConfig.motion.particleDelay,
                    duration: agentShowcaseAnimationConfig.motion.particleDuration,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                  }
                : { duration: 0 }
            }
          />
        ))}
      </div>

      <div className="absolute top-[1%] left-[5%] h-[98%] w-[38%] min-w-0">{messageThread}</div>
      <div className="absolute top-[5%] left-[42%] h-[90%] w-[32%]">{rive}</div>
      <div className="absolute top-[22%] right-0 w-[28%] min-w-0">{orderCard}</div>
    </div>
  );
}
