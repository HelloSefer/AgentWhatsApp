import type { AgentAction } from "../agent-action.types";

export interface DirectAgentResult {
  reply: string;
  actions?: AgentAction[];
}
