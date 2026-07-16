import { CircleDot, MessagesSquare, Package } from "lucide-react";
import { heroContent } from "../data/hero-content";
import { ConversationMessage } from "./conversation-message";

export function ConversationPanel() {
  const { conversation } = heroContent;

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-marketing-border bg-marketing-surface shadow-[0_14px_32px_-28px_oklch(0.2_0.04_155/0.4)] sm:rounded-2xl">
      <header className="flex items-center justify-between gap-2 border-b border-marketing-border px-2.5 py-2.5 sm:px-3 sm:py-3">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-marketing-subtle text-marketing-primary sm:size-8 sm:rounded-lg">
            <MessagesSquare aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{conversation.agentName}</p>
            <p className="truncate text-xs text-muted-foreground">{conversation.workspaceLabel}</p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-medium text-marketing-primary">
          <CircleDot aria-hidden="true" className="size-3.5" />
          <span className="hidden min-[360px]:inline">{conversation.activeLabel}</span>
        </span>
      </header>

      <div className="p-2.5 sm:p-3.5">
        <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-marketing-border bg-marketing-canvas px-2 py-1 text-xs font-medium text-foreground sm:gap-2 sm:rounded-lg sm:px-2.5 sm:py-1.5">
          <Package aria-hidden="true" className="size-3.5 shrink-0 text-marketing-primary" />
          <span className="truncate">{conversation.productLabel}</span>
        </div>

        <div className="mt-2.5 flex min-w-0 flex-col gap-1.5 sm:mt-3.5 sm:gap-2">
          {conversation.messages.map((message, index) => (
            <ConversationMessage key={`${message.sender}-${index}`} message={message} />
          ))}
        </div>
      </div>

      <footer className="border-t border-marketing-border bg-marketing-canvas px-2.5 py-2.5 sm:px-3.5 sm:py-3">
        <p className="text-xs font-medium text-foreground">{conversation.collectionLabel}</p>
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Order details being collected">
          {conversation.collectionFields.map((field) => (
            <li className="rounded-md border border-marketing-border bg-marketing-surface px-2 py-1 text-[0.6875rem] font-medium text-muted-foreground" key={field}>
              {field}
            </li>
          ))}
        </ul>
      </footer>
    </section>
  );
}
