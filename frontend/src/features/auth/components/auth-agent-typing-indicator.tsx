"use client";

import { motion } from "motion/react";
import { authAgentAnimationConfig } from "../config/auth-agent-animation-config";

type AuthAgentTypingIndicatorProps = Readonly<{
  shouldReduceMotion: boolean;
}>;

export function AuthAgentTypingIndicator({ shouldReduceMotion }: AuthAgentTypingIndicatorProps) {
  return (
    <div className="ml-3 flex w-fit items-center gap-1 rounded-xl border border-marketing-primary/15 bg-[#eef8f1] px-3 py-2.5" role="presentation">
      <span className="mr-1 text-[0.625rem] font-semibold tracking-[0.06em] text-[#477257] uppercase">AgentWhatsApp</span>
      {[0, 1, 2].map((dot) => (
        <motion.span
          animate={shouldReduceMotion ? { opacity: 0.55, y: 0 } : { opacity: [0.35, 1, 0.35], y: [0, -2, 0] }}
          className="size-1.5 rounded-full bg-marketing-primary"
          key={dot}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : {
                  delay: dot * authAgentAnimationConfig.motion.particleDelay,
                  duration: authAgentAnimationConfig.motion.typingDot,
                  ease: "easeInOut",
                  repeat: Number.POSITIVE_INFINITY,
                }
          }
        />
      ))}
    </div>
  );
}
