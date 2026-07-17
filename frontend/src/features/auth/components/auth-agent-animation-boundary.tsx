"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { AuthAgentAnimationFallback } from "./auth-agent-animation-fallback";

const AuthAgentAnimation = dynamic(() => import("./auth-agent-animation").then((module) => module.AuthAgentAnimation), {
  loading: () => <AuthAgentAnimationFallback />,
  ssr: false,
});

type AuthAgentAnimationBoundaryState = Readonly<{
  hasError: boolean;
}>;

class AuthAgentSceneErrorBoundary extends Component<Readonly<{ children: ReactNode }>, AuthAgentAnimationBoundaryState> {
  state: AuthAgentAnimationBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AuthAgentAnimationBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <AuthAgentAnimationFallback />;
    }

    return this.props.children;
  }
}

export function AuthAgentAnimationBoundary() {
  return (
    <AuthAgentSceneErrorBoundary>
      <AuthAgentAnimation />
    </AuthAgentSceneErrorBoundary>
  );
}
