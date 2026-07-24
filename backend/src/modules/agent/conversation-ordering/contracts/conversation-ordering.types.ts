export type ConversationOrderingIdentity = Readonly<{
  sellerId: string;
  conversationKey: string;
  messageId: string;
}>;

export type ReservedConversationTurn = Readonly<{
  orderingKey: string;
  sequence: number;
  messageKey: string;
}>;

export type ConversationTurnClaim = Readonly<{
  orderingKey: string;
  sequence: number;
  ownerToken: string;
  leaseExpiresAt: string;
}>;

export type ConversationTurnClaimResult =
  | Readonly<{ status: "claimed"; claim: ConversationTurnClaim }>
  | Readonly<{ status: "wait"; expectedSequence: number; activeSequence?: number }>
  | Readonly<{ status: "alreadyCompleted"; expectedSequence: number }>
  | Readonly<{ status: "invalidTurn" }>;

export type ConversationTurnRenewResult =
  | Readonly<{ status: "renewed"; leaseExpiresAt: string }>
  | Readonly<{ status: "lostLease" }>;

export type ConversationTurnCompleteResult =
  | Readonly<{ status: "completed"; nextExpectedSequence: number }>
  | Readonly<{ status: "alreadyCompleted"; expectedSequence: number }>
  | Readonly<{ status: "lostLease" }>;

export type ConversationTurnReleaseResult =
  | Readonly<{ status: "released" }>
  | Readonly<{ status: "lostLease" }>;

export type ConversationOrderingState = Readonly<{
  orderingKey: string;
  nextSequence: number;
  expectedSequence: number;
  activeSequence?: number;
  leaseTtlMs?: number;
}>;

export type ConversationOrderingCoordinator = Readonly<{
  reserveTurn: (identity: ConversationOrderingIdentity) => Promise<ReservedConversationTurn>;
  tryClaimTurn: (
    turn: Pick<ReservedConversationTurn, "orderingKey" | "sequence">,
    leaseOwner: string,
  ) => Promise<ConversationTurnClaimResult>;
  renewTurnLease: (claim: ConversationTurnClaim) => Promise<ConversationTurnRenewResult>;
  completeTurn: (claim: ConversationTurnClaim) => Promise<ConversationTurnCompleteResult>;
  releaseTurn: (claim: ConversationTurnClaim) => Promise<ConversationTurnReleaseResult>;
  inspectTurnState: (orderingKey: string) => Promise<ConversationOrderingState>;
}>;
