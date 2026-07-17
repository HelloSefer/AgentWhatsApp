"use client";

import { useId, useRef } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { AuthAgentMessageBubbles } from "./auth-agent-message-bubbles";
import { AuthAgentOrderCard } from "./auth-agent-order-card";
import { AuthAgentRobotSvg } from "./auth-agent-robot-svg";

const sceneDescription = "AgentWhatsApp AI assistant turning a customer conversation into a confirmed order";

const sceneVariants = {
  active: {
    opacity: 1,
    scale: [0.997, 1],
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
  static: { opacity: 1, scale: 1, transition: { duration: 0 } },
};

export function AuthAgentAnimation() {
  const sceneId = useId().replaceAll(":", "");
  const sceneRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(sceneRef, { amount: 0.2 });
  const shouldReduceMotion = useReducedMotion();
  const isAnimated = isInView && !shouldReduceMotion;

  return (
    <div
      aria-label={sceneDescription}
      className="relative aspect-[36/23] w-full overflow-visible"
      ref={sceneRef}
      role="img"
    >
      <motion.svg
        animate={isAnimated ? "active" : "static"}
        aria-hidden="true"
        className="block size-full overflow-visible"
        focusable="false"
        initial={false}
        preserveAspectRatio="xMidYMid meet"
        variants={sceneVariants}
        viewBox="0 0 720 430"
      >
        <defs>
          <radialGradient id={`${sceneId}-scene-glow`} cx="52%" cy="52%" r="56%">
            <stop offset="0" stopColor="#c9efd3" stopOpacity="0.78" />
            <stop offset="0.52" stopColor="#eaf7ed" stopOpacity="0.38" />
            <stop offset="1" stopColor="#fbfdf9" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="369" cy="244" fill={`url(#${sceneId}-scene-glow)`} rx="275" ry="178" />

        <g className="hidden sm:block">
          {[
            [120, 319, 3],
            [213, 294, 2.5],
            [274, 72, 3],
            [447, 79, 2.5],
            [620, 104, 3],
            [672, 340, 2.5],
          ].map(([cx, cy, radius], index) => (
            <motion.circle
              animate={isAnimated ? { opacity: [0.22, 0.62, 0.22], y: [0, -5, 0] } : { opacity: 0.35, y: 0 }}
              cx={cx}
              cy={cy}
              fill="#75a987"
              key={`${cx}-${cy}`}
              r={radius}
              transition={isAnimated ? { delay: index * 0.35, duration: 4.8 + index * 0.2, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY } : { duration: 0 }}
            />
          ))}
        </g>

        <AuthAgentMessageBubbles isAnimated={isAnimated} />
        <motion.g
          animate={isAnimated ? { rotate: [0, -0.65, 0, 0.55, 0], y: [0, -3, 0, 2, 0] } : { rotate: 0, y: 0 }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          transition={
            isAnimated
              ? { duration: 5.8, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY, times: [0, 0.25, 0.5, 0.75, 1] }
              : { duration: 0 }
          }
        >
          <AuthAgentRobotSvg idPrefix={sceneId} isAnimated={isAnimated} />
        </motion.g>
        <AuthAgentOrderCard isAnimated={isAnimated} />
      </motion.svg>
    </div>
  );
}
