export type CloudReplyDispatchMode = "text" | "interactive";

export type CloudReplyDispatchResult = {
  ok: boolean;
  mode: CloudReplyDispatchMode;
  dryRun: boolean;
  fallbackUsed?: boolean;
  interactiveBlocked?: boolean;
  reason?: string;
  textResult?: unknown;
  interactiveResult?: unknown;
  error?: string;
};
