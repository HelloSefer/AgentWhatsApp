import { AuthAgentAnimationBoundary } from "./auth-agent-animation-boundary";

const sceneDescription = "AgentWhatsApp AI assistant turning a customer conversation into a confirmed order";

export function AuthAgentStage() {
  return (
    <aside aria-label={sceneDescription} className="relative isolate hidden w-full min-w-0 md:max-w-xl md:justify-self-center lg:max-w-none lg:justify-self-stretch md:block">
      <div aria-hidden="true" className="pointer-events-none absolute top-[18%] left-[28%] h-44 w-52 rounded-full bg-marketing-muted/75 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute right-[9%] bottom-[19%] size-16 rounded-full bg-[#dff1e4]/80 blur-2xl" />
      <AuthAgentAnimationBoundary />
    </aside>
  );
}
