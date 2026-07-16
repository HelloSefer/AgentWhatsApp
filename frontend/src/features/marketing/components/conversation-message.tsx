import type { ConversationMessage as ConversationMessageType } from "../types/marketing.types";

type ConversationMessageProps = Readonly<{
  message: ConversationMessageType;
}>;

export function ConversationMessage({ message }: ConversationMessageProps) {
  const isAgent = message.sender === "agent";

  return (
    <div className={isAgent ? "min-w-0 self-start" : "min-w-0 self-end"} dir="auto">
      <div
        className={
          isAgent
            ? "max-w-[min(17.5rem,100%)] [overflow-wrap:anywhere] rounded-lg rounded-tl-sm border border-marketing-border bg-marketing-subtle px-2.5 py-1.5 text-xs leading-[1.125rem] text-foreground sm:rounded-xl sm:px-3 sm:py-2"
            : "max-w-[min(17.5rem,100%)] [overflow-wrap:anywhere] rounded-lg rounded-tr-sm border border-marketing-border bg-marketing-surface px-2.5 py-1.5 text-xs leading-[1.125rem] text-foreground shadow-xs sm:rounded-xl sm:px-3 sm:py-2"
        }
      >
        <p dir="auto">{message.content}</p>
      </div>
    </div>
  );
}
