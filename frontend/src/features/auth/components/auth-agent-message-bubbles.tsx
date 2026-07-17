import { motion } from "motion/react";
import { authAgentAnimationConfig, createAuthAgentTransition } from "../config/auth-agent-animation-config";

type AuthAgentMessageBubblesProps = Readonly<{
  isAnimated: boolean;
}>;

export function AuthAgentMessageBubbles({ isAnimated }: AuthAgentMessageBubblesProps) {
  const { timeline } = authAgentAnimationConfig;

  return (
    <g aria-hidden="true">
      <motion.g
        animate={
          isAnimated
            ? { opacity: [0, 0, 1, 1, 0, 0], x: [-12, -12, 0, 0, -5, -5] }
            : { opacity: 1, x: 0 }
        }
        transition={isAnimated ? createAuthAgentTransition(timeline.customerMessage) : { duration: 0 }}
      >
        <rect fill="#ffffff" height="58" rx="15" stroke="#d9e8dd" strokeWidth="1.5" width="190" x="34" y="76" />
        <path d="M68 132 57 145 81 134" fill="#ffffff" stroke="#d9e8dd" strokeLinejoin="round" strokeWidth="1.5" />
        <circle cx="61" cy="104" fill="#dcefe2" r="12" />
        <text fill="#3d6950" fontFamily="var(--font-geist-sans), sans-serif" fontSize="11" fontWeight="700" x="57.5" y="108">
          C
        </text>
        <text fill="#2d4736" fontFamily="var(--font-geist-sans), sans-serif" fontSize="11.5" fontWeight="600" x="82" y="101">
          Customer
        </text>
        <text fill="#617266" fontFamily="var(--font-geist-sans), sans-serif" fontSize="10.5" x="82" y="118">
          Two delivery slots, please.
        </text>
      </motion.g>

      <motion.g
        animate={isAnimated ? { opacity: [0, 0, 1, 1, 0, 0, 0, 0] } : { opacity: 0 }}
        className="hidden sm:block"
        transition={isAnimated ? createAuthAgentTransition(timeline.typing) : { duration: 0 }}
      >
        <rect fill="#f2f8f3" height="34" rx="14" stroke="#d2e4d6" strokeWidth="1.5" width="78" x="145" y="156" />
        {[0, 1, 2].map((dot) => (
          <motion.circle
            animate={isAnimated ? { opacity: [0.35, 1, 0.35], y: [0, -2, 0] } : { opacity: 0.7, y: 0 }}
            cx={168 + dot * 13}
            cy="173"
            fill="#3f7854"
            key={dot}
            r="4"
            transition={
              isAnimated
                ? { delay: dot * 0.12, duration: 0.8, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }
                : { duration: 0 }
            }
          />
        ))}
      </motion.g>
    </g>
  );
}
