import { motion } from "motion/react";
import { authAgentAnimationConfig, createAuthAgentTransition } from "../config/auth-agent-animation-config";

type AuthAgentOrderCardProps = Readonly<{
  isAnimated: boolean;
}>;

const orderRows = [
  { label: "Customer", value: "Details collected", timing: "customerRow", checkTiming: "customerCheck" },
  { label: "Product", value: "Item selected", timing: "productRow", checkTiming: "productCheck" },
  { label: "Delivery", value: "Method confirmed", timing: "deliveryRow", checkTiming: "deliveryCheck" },
] as const;

export function AuthAgentOrderCard({ isAnimated }: AuthAgentOrderCardProps) {
  const { timeline } = authAgentAnimationConfig;

  return (
    <motion.g
      animate={
        isAnimated
          ? { opacity: [0, 0, 1, 1, 0, 0], scale: [0.97, 0.97, 1, 1, 0.985, 0.985], x: [10, 10, 0, 0, 5, 5] }
          : { opacity: 1, scale: 1, x: 0 }
      }
      aria-hidden="true"
      style={{ transformBox: "fill-box", transformOrigin: "center" }}
      transition={isAnimated ? createAuthAgentTransition(timeline.orderCard) : { duration: 0 }}
    >
      <rect fill="#7f9989" height="190" opacity="0.12" rx="17" width="202" x="490" y="139" />
      <rect fill="#ffffff" height="190" rx="17" stroke="#d1e0d5" strokeWidth="1.5" width="202" x="483" y="132" />
      <circle cx="508" cy="157" fill="#e1f2e5" r="11" />
      <path d="M503 157 507 161 514 153" fill="none" stroke="#39734d" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" />
      <text fill="#24402f" fontFamily="var(--font-geist-sans), sans-serif" fontSize="13" fontWeight="700" x="526" y="161">
        Order details
      </text>
      <line stroke="#e4ece6" x1="501" x2="666" y1="178" y2="178" />

      {orderRows.map((row, index) => {
        const rowY = 198 + index * 34;

        return (
          <motion.g
            animate={
              isAnimated
                ? { opacity: [0, 0, 1, 1, 0, 0], y: [7, 7, 0, 0, 3, 3] }
                : { opacity: 1, y: 0 }
            }
            key={row.label}
            transition={isAnimated ? createAuthAgentTransition(timeline[row.timing]) : { duration: 0 }}
          >
            <circle cx="508" cy={rowY + 4} fill="#edf5ef" r="8" />
            <rect fill="#86a38f" height="7" opacity="0.75" rx="2" width="7" x="504.5" y={rowY + 0.5} />
            <text fill="#2d4736" fontFamily="var(--font-geist-sans), sans-serif" fontSize="10.5" fontWeight="650" x="524" y={rowY + 1}>
              {row.label}
            </text>
            <text fill="#718076" fontFamily="var(--font-geist-sans), sans-serif" fontSize="8.75" x="524" y={rowY + 15}>
              {row.value}
            </text>
            <circle cx="659" cy={rowY + 4} fill="#e3f3e7" r="9" />
            <motion.path
              animate={isAnimated ? { opacity: [0, 0, 1, 1, 0, 0], pathLength: [0, 0, 1, 1, 1, 1] } : { opacity: 1, pathLength: 1 }}
              d={`M654 ${rowY + 4}l3 3 6-7`}
              fill="none"
              stroke="#34764a"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              transition={isAnimated ? createAuthAgentTransition(timeline[row.checkTiming]) : { duration: 0 }}
            />
          </motion.g>
        );
      })}

      <motion.rect
        animate={isAnimated ? { opacity: [0, 0, 0.35, 0, 0, 0, 0], scale: [0.96, 0.96, 1, 1.06, 1.06, 1.06, 1.06] } : { opacity: 0, scale: 1 }}
        fill="none"
        height="32"
        rx="11"
        stroke="#58a36f"
        strokeWidth="2"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        transition={isAnimated ? createAuthAgentTransition(timeline.confirmationPulse) : { duration: 0 }}
        width="153"
        x="507"
        y="277"
      />
      <motion.g
        animate={
          isAnimated
            ? { opacity: [0, 0, 1, 1, 0, 0], scale: [0.94, 0.94, 1, 1, 0.98, 0.98] }
            : { opacity: 1, scale: 1 }
        }
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        transition={isAnimated ? createAuthAgentTransition(timeline.confirmation) : { duration: 0 }}
      >
        <rect fill="#315f43" height="32" rx="11" width="153" x="507" y="277" />
        <circle cx="525" cy="293" fill="#8ed0a2" r="8" />
        <path d="M521 293 524 296 530 289" fill="none" stroke="#173d26" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
        <text fill="#f6fff8" fontFamily="var(--font-geist-sans), sans-serif" fontSize="10.5" fontWeight="700" x="540" y="297">
          Order confirmed
        </text>
      </motion.g>
    </motion.g>
  );
}
