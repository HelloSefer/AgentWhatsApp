export function AgentShowcaseFallback() {
  return (
    <div aria-hidden="true" className="relative aspect-[4/3] w-full overflow-hidden">
      <div className="absolute top-[16%] left-[29%] h-[58%] w-[42%] rounded-full bg-[radial-gradient(circle,rgba(201,239,211,0.62)_0%,rgba(234,247,237,0.28)_56%,transparent_76%)]" />
      <div className="absolute top-1/2 left-1/2 h-px w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-marketing-primary/20 motion-safe:animate-pulse" />
    </div>
  );
}
