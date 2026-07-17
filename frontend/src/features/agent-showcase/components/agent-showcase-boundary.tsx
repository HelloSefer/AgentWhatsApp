"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { AgentShowcaseFallback } from "./agent-showcase-fallback";

const AgentShowcaseAnimation = dynamic(() => import("./agent-showcase-animation").then((module) => module.AgentShowcaseAnimation), {
  loading: () => <AgentShowcaseFallback />,
  ssr: false,
});

type AgentShowcaseBoundaryState = Readonly<{
  hasError: boolean;
}>;

class AgentShowcaseSceneErrorBoundary extends Component<Readonly<{ children: ReactNode }>, AgentShowcaseBoundaryState> {
  state: AgentShowcaseBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AgentShowcaseBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <AgentShowcaseFallback />;
    }

    return this.props.children;
  }
}

export function AgentShowcaseBoundary() {
  return (
    <AgentShowcaseSceneErrorBoundary>
      <AgentShowcaseAnimation />
    </AgentShowcaseSceneErrorBoundary>
  );
}
