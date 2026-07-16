export type MarketingIconName = "cloud" | "commerce" | "language";

export type MarketingAction = Readonly<{
  label: string;
  href: string;
}>;

export type TrustIndicator = Readonly<{
  label: string;
  icon: MarketingIconName;
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
