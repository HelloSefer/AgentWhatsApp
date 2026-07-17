"use client";

import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { authAgentAnimationConfig, type OrderFieldState } from "../config/auth-agent-animation-config";

type AuthAgentOrderCardProps = Readonly<{
  fields: readonly OrderFieldState[];
  isConfirmed: boolean;
  isSettling: boolean;
  shouldReduceMotion: boolean;
}>;

export function AuthAgentOrderCard({ fields, isConfirmed, isSettling, shouldReduceMotion }: AuthAgentOrderCardProps) {
  const visibleFields = fields.filter((field) => field.status !== "hidden");
  const isVisible = visibleFields.length > 0 || isConfirmed;

  return (
    <AnimatePresence initial={false}>
      {isVisible ? (
        <motion.section
          animate={{ opacity: isSettling ? 0 : 1, scale: 1, x: 0 }}
          aria-hidden="true"
          className="w-full rounded-2xl border border-[#d1e0d5] bg-white p-3.5 shadow-[0_18px_34px_-27px_oklch(0.2_0.04_155/0.42)]"
          exit={{ opacity: 0, scale: 0.98, x: authAgentAnimationConfig.motion.slide }}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98, x: authAgentAnimationConfig.motion.slide }}
          transition={{ duration: shouldReduceMotion ? 0 : isSettling ? authAgentAnimationConfig.motion.exit : authAgentAnimationConfig.motion.enter, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center gap-2 border-b border-[#e4ece6] pb-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#e1f2e5] text-[#39734d]">
              <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
            </span>
            <p className="text-xs font-semibold text-[#24402f]">Order details</p>
          </div>

          <ul className="mt-2.5 space-y-2.5">
            <AnimatePresence initial={false}>
              {visibleFields.map((field) => (
                <motion.li
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: authAgentAnimationConfig.motion.slide }}
                  key={field.field}
                  transition={{ duration: shouldReduceMotion ? 0 : authAgentAnimationConfig.motion.enter, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="min-w-0">
                    <p className="text-[0.625rem] leading-3 font-semibold text-[#6b7a70]">{field.label}</p>
                    <p className="truncate text-xs leading-4 font-medium text-[#2d4736]">{field.value}</p>
                  </div>
                  <span className="flex size-5 items-center justify-center rounded-full bg-[#e3f3e7] text-[#34764a]">
                    <motion.span
                      animate={{ opacity: field.status === "validated" ? 1 : 0, scale: field.status === "validated" ? 1 : 0.65 }}
                      transition={{ duration: shouldReduceMotion ? 0 : authAgentAnimationConfig.motion.enter, ease: "easeOut" }}
                    >
                      <Check aria-hidden="true" className="size-3" strokeWidth={2.75} />
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
                className="mt-3 flex items-center gap-2 rounded-xl bg-[#315f43] px-3 py-2 text-white"
                initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
                key="confirmed"
                transition={{ duration: shouldReduceMotion ? 0 : authAgentAnimationConfig.motion.confirmationPulse, ease: "easeOut" }}
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-[#8ed0a2] text-[#173d26]">
                  <Check aria-hidden="true" className="size-3" strokeWidth={2.75} />
                </span>
                <span className="text-[0.68rem] font-semibold">Order confirmed</span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
