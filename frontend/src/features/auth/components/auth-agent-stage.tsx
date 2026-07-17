import { AuthAgentAnimationBoundary } from "./auth-agent-animation-boundary";

const sceneDescription = "AgentWhatsApp AI assistant answering a Moroccan customer and confirming an order";

export function AuthAgentStage() {
  return (
    <aside
      aria-label={sceneDescription}
      className="relative isolate hidden w-full min-w-0 md:max-w-xl md:justify-self-center md:block lg:-ml-12 lg:w-[calc(100%_+_5rem)] lg:max-w-none lg:justify-self-stretch xl:-ml-16 xl:w-[calc(100%_+_8rem)]"
    >
      <div aria-hidden="true" className="pointer-events-none absolute top-[18%] left-[28%] h-44 w-52 rounded-full bg-marketing-muted/75 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute right-[9%] bottom-[19%] size-16 rounded-full bg-[#dff1e4]/80 blur-2xl" />
      <AuthAgentAnimationBoundary />
    </aside>
  );
}
