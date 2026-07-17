"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ChatMessage } from "../config/auth-agent-animation-config";
import { authAgentAnimationConfig } from "../config/auth-agent-animation-config";
import { AuthAgentMessageBubble } from "./auth-agent-message-bubble";
import { AuthAgentTypingIndicator } from "./auth-agent-typing-indicator";

type AuthAgentMessageThreadProps = Readonly<{
  isSettling: boolean;
  isTyping: boolean;
  messages: readonly ChatMessage[];
  shouldReduceMotion: boolean;
}>;

export function AuthAgentMessageThread({ isSettling, isTyping, messages, shouldReduceMotion }: AuthAgentMessageThreadProps) {
  return (
    <motion.div
      animate={{ opacity: isSettling ? 0 : 1 }}
      aria-hidden="true"
      className="h-full w-full"
      transition={{ duration: shouldReduceMotion ? 0 : authAgentAnimationConfig.motion.exit, ease: "easeOut" }}
    >
      <ol className="flex h-full flex-col justify-start gap-2">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.li
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -authAgentAnimationConfig.motion.slide }}
              initial={shouldReduceMotion ? false : { opacity: 0, x: -authAgentAnimationConfig.motion.slide }}
              key={message.id}
              layout="position"
              transition={{ duration: shouldReduceMotion ? 0 : authAgentAnimationConfig.motion.enter, ease: [0.22, 1, 0.36, 1] }}
            >
              <AuthAgentMessageBubble message={message} />
            </motion.li>
          ))}
          {isTyping ? (
            <motion.li
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: 4 }}
              key="agent-typing"
              transition={{ duration: authAgentAnimationConfig.motion.enter }}
            >
              <AuthAgentTypingIndicator shouldReduceMotion={shouldReduceMotion} />
            </motion.li>
          ) : null}
        </AnimatePresence>
      </ol>
    </motion.div>
  );
}
