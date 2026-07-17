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

export type HeroContent = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: MarketingAction;
  secondaryAction: MarketingAction;
  trustIndicators: readonly TrustIndicator[];
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

export type PricingPlan = Readonly<{
  id: string;
  name: string;
  price: number;
  currency: "MAD";
  billingPeriod: "month";
  description: string;
  features: readonly string[];
  ctaLabel: string;
  ctaHref: string;
  featured: boolean;
  badge?: string;
}>;

export type FaqItem = Readonly<{
  question: string;
  answer: string;
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
  differentiation: MarketingSectionContent &
    Readonly<{
      items: readonly MarketingContentItem[];
    }>;
  finalCta: MarketingSectionContent &
    Readonly<{
      primaryAction: MarketingAction;
      secondaryAction: MarketingAction;
    }>;
}>;
