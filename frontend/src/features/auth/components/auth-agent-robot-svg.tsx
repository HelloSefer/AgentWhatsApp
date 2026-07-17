import { motion } from "motion/react";
import { authAgentAnimationConfig, createAuthAgentTransition } from "../config/auth-agent-animation-config";

type AuthAgentRobotSvgProps = Readonly<{
  idPrefix: string;
  isAnimated: boolean;
}>;

export function AuthAgentRobotSvg({ idPrefix, isAnimated }: AuthAgentRobotSvgProps) {
  const { timeline } = authAgentAnimationConfig;

  return (
    <g aria-hidden="true">
      <defs>
        <linearGradient id={`${idPrefix}-robot-shell`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.58" stopColor="#edf1ee" />
          <stop offset="1" stopColor="#b9c4bd" />
        </linearGradient>
        <linearGradient id={`${idPrefix}-robot-joint`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#d5ddd7" />
          <stop offset="1" stopColor="#809087" />
        </linearGradient>
        <linearGradient id={`${idPrefix}-robot-face`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#25372f" />
          <stop offset="1" stopColor="#0e1914" />
        </linearGradient>
        <linearGradient id={`${idPrefix}-robot-accent`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#a9e7b8" />
          <stop offset="1" stopColor="#397c4e" />
        </linearGradient>
      </defs>

      <ellipse cx="343" cy="393" fill="#52645a" opacity="0.16" rx="103" ry="12" />

      <motion.g
        animate={isAnimated ? { rotate: [0, -0.9, -0.9, 0, 0.7, 0.7, 0] } : { rotate: 0 }}
        style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}
        transition={isAnimated ? createAuthAgentTransition(timeline.robotFocus) : { duration: 0 }}
      >
        <path d="M340 99V82" fill="none" stroke="#809087" strokeLinecap="round" strokeWidth="4" />
        <motion.rect
          animate={isAnimated ? { opacity: [0.65, 0.65, 1, 1, 0.75, 0.75, 1, 0.8, 0.65] } : { opacity: 1 }}
          fill={`url(#${idPrefix}-robot-accent)`}
          height="13"
          rx="6.5"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          transition={isAnimated ? createAuthAgentTransition(timeline.robotFocus) : { duration: 0 }}
          width="13"
          x="333.5"
          y="68"
        />

        <rect fill={`url(#${idPrefix}-robot-joint)`} height="42" rx="18" width="26" x="236" y="137" />
        <rect fill="#315240" height="27" rx="12" width="14" x="242" y="145" />
        <rect fill={`url(#${idPrefix}-robot-joint)`} height="42" rx="18" width="26" x="419" y="137" />
        <rect fill="#315240" height="27" rx="12" width="14" x="425" y="145" />

        <rect fill={`url(#${idPrefix}-robot-shell)`} height="111" rx="38" stroke="#b5c0b8" strokeWidth="2" width="170" x="255" y="96" />
        <path d="M280 122c30-15 88-16 119 1" fill="none" opacity="0.72" stroke="#ffffff" strokeLinecap="round" strokeWidth="7" />
        <rect fill={`url(#${idPrefix}-robot-face)`} height="69" rx="23" stroke="#62746a" strokeWidth="1.5" width="126" x="277" y="126" />
        <path d="M292 141c23-8 67-9 94-1" fill="none" opacity="0.09" stroke="#ffffff" strokeLinecap="round" strokeWidth="5" />

        <motion.g
          animate={isAnimated ? { x: [0, 0, 1, 1, 0, 0, -1, 0, 0] } : { x: 0 }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
          transition={isAnimated ? createAuthAgentTransition(timeline.robotFocus) : { duration: 0 }}
        >
          <motion.rect
            animate={isAnimated ? { opacity: [0.78, 0.78, 1, 1, 0.8, 0.8, 1, 0.9, 0.78] } : { opacity: 1 }}
            fill="#a6efb7"
            height="6"
            rx="3"
            transition={isAnimated ? createAuthAgentTransition(timeline.robotFocus) : { duration: 0 }}
            width="24"
            x="300"
            y="155"
          />
          <motion.rect
            animate={isAnimated ? { opacity: [0.78, 0.78, 1, 1, 0.8, 0.8, 1, 0.9, 0.78] } : { opacity: 1 }}
            fill="#a6efb7"
            height="6"
            rx="3"
            transition={isAnimated ? createAuthAgentTransition(timeline.robotFocus) : { duration: 0 }}
            width="24"
            x="356"
            y="155"
          />
        </motion.g>
        <motion.rect
          animate={isAnimated ? { opacity: [0.34, 0.34, 0.95, 0.95, 0.42, 0.42, 0.9, 0.58, 0.34] } : { opacity: 1 }}
          fill="#77c38b"
          height="3"
          rx="1.5"
          transition={isAnimated ? createAuthAgentTransition(timeline.robotFocus) : { duration: 0 }}
          width="64"
          x="308"
          y="180"
        />
      </motion.g>

      <rect fill="#7c8f84" height="20" rx="8" width="30" x="325" y="204" />
      <path d="M296 247c14-17 77-17 95 0l14 86c3 20-11 37-31 37h-61c-20 0-34-17-31-37Z" fill={`url(#${idPrefix}-robot-shell)`} stroke="#acb9b0" strokeWidth="2" />
      <path d="M300 257c20-13 63-14 87-1" fill="none" opacity="0.72" stroke="#ffffff" strokeLinecap="round" strokeWidth="6" />
      <path d="M307 336c18 8 51 8 69 0l3 17c-18 10-54 10-75 0Z" fill="#1d3d2b" />
      <rect fill={`url(#${idPrefix}-robot-accent)`} height="28" rx="8" width="42" x="319" y="279" />
      <path d="M331 293h18m-9-7 8 7-8 7" fill="none" stroke="#effff3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />

      <g>
        <path d="M294 262c-31 4-50 27-51 57" fill="none" stroke={`url(#${idPrefix}-robot-joint)`} strokeLinecap="round" strokeWidth="18" />
        <circle cx="240" cy="322" fill={`url(#${idPrefix}-robot-shell)`} r="13" stroke="#9eaca3" strokeWidth="1.5" />
        <path d="M234 322h12" fill="none" stroke="#466653" strokeLinecap="round" strokeWidth="2.5" />
      </g>

      <motion.g
        animate={isAnimated ? { rotate: [0, 0, -6, -6, -2, 0, 0] } : { rotate: -4 }}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
        transition={isAnimated ? createAuthAgentTransition(timeline.robotGesture) : { duration: 0 }}
      >
        <path d="M392 261c28 5 46 26 48 53" fill="none" stroke={`url(#${idPrefix}-robot-joint)`} strokeLinecap="round" strokeWidth="18" />
        <circle cx="444" cy="316" fill={`url(#${idPrefix}-robot-shell)`} r="13" stroke="#9eaca3" strokeWidth="1.5" />
        <path d="M438 316h12" fill="none" stroke="#466653" strokeLinecap="round" strokeWidth="2.5" />
      </motion.g>
    </g>
  );
}
