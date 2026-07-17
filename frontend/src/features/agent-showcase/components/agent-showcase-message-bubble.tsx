import { cn } from "@/lib/utils";
import type { ChatMessage } from "../config/agent-showcase-animation-config";

type AgentShowcaseMessageBubbleProps = Readonly<{
  message: ChatMessage;
}>;

export function AgentShowcaseMessageBubble({ message }: AgentShowcaseMessageBubbleProps) {
  const isAgent = message.sender === "agent";

  return (
    <article
      className={cn(
        "w-[calc(100%_-_0.75rem)] rounded-[0.875rem] border px-3.5 py-3 text-left shadow-[0_10px_24px_-20px_oklch(0.2_0.04_155/0.45)]",
        isAgent
          ? "ml-3 max-w-[18.125rem] border-marketing-primary/15 bg-[#eef8f1] text-[#24402f]"
          : "mr-3 max-w-[16.875rem] border-marketing-border bg-white text-[#263c2e]",
      )}
      dir="ltr"
    >
      <p className={cn("text-[0.6875rem] leading-4 font-semibold tracking-[0.07em] uppercase xl:text-xs", isAgent ? "text-[#477257]" : "text-[#66756b]")}>
        {isAgent ? "AgentWhatsApp" : "Customer"}
      </p>
      <p className="mt-1 text-[0.8125rem] leading-5 font-medium text-pretty xl:text-sm xl:leading-[1.3rem]">{message.body}</p>
    </article>
  );
}
