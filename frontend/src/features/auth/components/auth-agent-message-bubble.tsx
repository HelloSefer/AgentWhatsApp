import { cn } from "@/lib/utils";
import type { ChatMessage } from "../config/auth-agent-animation-config";

type AuthAgentMessageBubbleProps = Readonly<{
  message: ChatMessage;
}>;

export function AuthAgentMessageBubble({ message }: AuthAgentMessageBubbleProps) {
  const isAgent = message.sender === "agent";

  return (
    <article
      className={cn(
        "max-w-[15rem] rounded-xl border px-3 py-2 text-left shadow-[0_10px_24px_-20px_oklch(0.2_0.04_155/0.45)]",
        isAgent
          ? "ml-3 border-marketing-primary/15 bg-[#eef8f1] text-[#24402f]"
          : "mr-3 border-marketing-border bg-white text-[#263c2e]",
      )}
      dir="ltr"
    >
      <p className={cn("text-[0.625rem] leading-3 font-semibold tracking-[0.08em] uppercase", isAgent ? "text-[#477257]" : "text-[#66756b]")}>
        {isAgent ? "AgentWhatsApp" : "Customer"}
      </p>
      <p className="mt-1 text-[0.72rem] leading-4 font-medium text-pretty xl:text-[0.78rem] xl:leading-[1.12rem]">{message.body}</p>
    </article>
  );
}
