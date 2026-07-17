"use client";

import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { agentShowcaseAnimationConfig, type OrderFieldState } from "../config/agent-showcase-animation-config";

type AgentShowcaseOrderCardProps = Readonly<{
  fields: readonly OrderFieldState[];
  isConfirmed: boolean;
  isSettling: boolean;
  shouldReduceMotion: boolean;
}>;

export function AgentShowcaseOrderCard({ fields, isConfirmed, isSettling, shouldReduceMotion }: AgentShowcaseOrderCardProps) {
  const visibleFields = fields.filter((field) => field.status !== "hidden");
  const isVisible = visibleFields.length > 0 || isConfirmed;

  return (
    <AnimatePresence initial={false}>
      {isVisible ? (
        <motion.section
          animate={{ opacity: isSettling ? 0 : 1, scale: 1, x: 0 }}
          aria-hidden="true"
          className="w-full rounded-2xl border border-[#d1e0d5] bg-white p-4 shadow-[0_18px_34px_-27px_oklch(0.2_0.04_155/0.42)]"
          exit={{ opacity: 0, scale: 0.98, x: agentShowcaseAnimationConfig.motion.slide }}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98, x: agentShowcaseAnimationConfig.motion.slide }}
          transition={{ duration: shouldReduceMotion ? 0 : isSettling ? agentShowcaseAnimationConfig.motion.exit : agentShowcaseAnimationConfig.motion.enter, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center gap-2.5 border-b border-[#e4ece6] pb-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-[#e1f2e5] text-[#39734d]">
              <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
            </span>
            <p className="text-[0.8125rem] font-semibold text-[#24402f]">Order details</p>
          </div>

          <ul className="mt-3 space-y-3">
            <AnimatePresence initial={false}>
              {visibleFields.map((field) => (
                <motion.li
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: agentShowcaseAnimationConfig.motion.slide }}
                  key={field.field}
                  transition={{ duration: shouldReduceMotion ? 0 : agentShowcaseAnimationConfig.motion.enter, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="min-w-0">
                    <p className="text-[0.6875rem] leading-4 font-semibold text-[#6b7a70]">{field.label}</p>
                    <p className="truncate text-[0.8125rem] leading-5 font-medium text-[#2d4736]">{field.value}</p>
                  </div>
                  <span className="flex size-6 items-center justify-center rounded-full bg-[#e3f3e7] text-[#34764a]">
                    <motion.span
                      animate={{ opacity: field.status === "validated" ? 1 : 0, scale: field.status === "validated" ? 1 : 0.65 }}
                      transition={{ duration: shouldReduceMotion ? 0 : agentShowcaseAnimationConfig.motion.enter, ease: "easeOut" }}
                    >
                      <Check aria-hidden="true" className="size-3.5" strokeWidth={2.75} />
                    </motion.span>
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <AnimatePresence initial={false}>
            {isConfirmed ? (
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                className="mt-3.5 flex items-center gap-2.5 rounded-xl bg-[#315f43] px-3.5 py-2.5 text-white"
                initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
                key="confirmed"
                transition={{ duration: shouldReduceMotion ? 0 : agentShowcaseAnimationConfig.motion.confirmationPulse, ease: "easeOut" }}
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-[#8ed0a2] text-[#173d26]">
                  <Check aria-hidden="true" className="size-3" strokeWidth={2.75} />
                </span>
                <span className="text-xs font-semibold">Order confirmed</span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
