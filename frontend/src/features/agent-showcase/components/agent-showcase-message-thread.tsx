"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ChatMessage } from "../config/agent-showcase-animation-config";
import { agentShowcaseAnimationConfig } from "../config/agent-showcase-animation-config";
import { AgentShowcaseMessageBubble } from "./agent-showcase-message-bubble";
import { AgentShowcaseTypingIndicator } from "./agent-showcase-typing-indicator";

type AgentShowcaseMessageThreadProps = Readonly<{
  isSettling: boolean;
  isTyping: boolean;
  messages: readonly ChatMessage[];
  shouldReduceMotion: boolean;
}>;

export function AgentShowcaseMessageThread({ isSettling, isTyping, messages, shouldReduceMotion }: AgentShowcaseMessageThreadProps) {
  return (
    <motion.div
      animate={{ opacity: isSettling ? 0 : 1 }}
      aria-hidden="true"
      className="h-full w-full"
      transition={{ duration: shouldReduceMotion ? 0 : agentShowcaseAnimationConfig.motion.exit, ease: "easeOut" }}
    >
      <ol className="flex h-full flex-col justify-start gap-2">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.li
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -agentShowcaseAnimationConfig.motion.slide }}
              initial={shouldReduceMotion ? false : { opacity: 0, x: -agentShowcaseAnimationConfig.motion.slide }}
              key={message.id}
              layout="position"
              transition={{ duration: shouldReduceMotion ? 0 : agentShowcaseAnimationConfig.motion.enter, ease: [0.22, 1, 0.36, 1] }}
            >
              <AgentShowcaseMessageBubble message={message} />
            </motion.li>
          ))}
          {isTyping ? (
            <motion.li
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: 4 }}
              key="agent-typing"
              transition={{ duration: agentShowcaseAnimationConfig.motion.enter }}
            >
              <AgentShowcaseTypingIndicator shouldReduceMotion={shouldReduceMotion} />
            </motion.li>
          ) : null}
        </AnimatePresence>
      </ol>
    </motion.div>
  );
}
