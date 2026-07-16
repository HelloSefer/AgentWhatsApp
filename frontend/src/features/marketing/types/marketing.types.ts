export type MarketingIconName =
  | "cloud"
  | "commerce"
  | "language"
  | "message"
  | "timer"
  | "list"
  | "brain"
  | "reply"
  | "collect"
  | "check"
  | "folder"
  | "sliders"
  | "receipt"
  | "package"
  | "link"
  | "rocket";

export type MarketingAction = Readonly<{
  label: string;
  href: string;
}>;

export type TrustIndicatorIconName = "cloud" | "commerce" | "language";

export type TrustIndicator = Readonly<{
  label: string;
  icon: TrustIndicatorIconName;
}>;

export type ConversationMessage = Readonly<{
  sender: "customer" | "agent";
  content: string;
}>;

export type OrderDetail = Readonly<{
  label: string;
  value: string;
}>;

export type HeroContent = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: MarketingAction;
  secondaryAction: MarketingAction;
  trustIndicators: readonly TrustIndicator[];
  conversation: Readonly<{
    agentName: string;
    workspaceLabel: string;
    activeLabel: string;
    productLabel: string;
    messages: readonly ConversationMessage[];
    collectionLabel: string;
    collectionFields: readonly string[];
  }>;
  order: Readonly<{
    title: string;
    status: string;
    details: readonly OrderDetail[];
  }>;
  activity: Readonly<{
    title: string;
    description: string;
    timestamp: string;
  }>;
}>;

export type MarketingSectionContent = Readonly<{
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}>;

export type MarketingContentItem = Readonly<{
  title: string;
  description: string;
  icon: MarketingIconName;
}>;

export type WorkflowStage = MarketingContentItem &
  Readonly<{
    number: string;
  }>;

export type LandingContent = Readonly<{
  problem: MarketingSectionContent &
    Readonly<{
      items: readonly MarketingContentItem[];
    }>;
  solution: MarketingSectionContent &
    Readonly<{
      statement: string;
      stages: readonly WorkflowStage[];
    }>;
  features: MarketingSectionContent &
    Readonly<{
      items: readonly MarketingContentItem[];
    }>;
  howItWorks: MarketingSectionContent &
    Readonly<{
      steps: readonly WorkflowStage[];
    }>;
}>;
