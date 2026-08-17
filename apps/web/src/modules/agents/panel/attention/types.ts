import type { AgentSessionSummary } from "@deskcue/protocol";
import type { AgentSessionWorkIndicator } from "@modules/agents/types";

export type AgentSessionsAttentionProps = {
  approvalRequestedSourceSessionIds: ReadonlySet<string>;
  readyForReviewAgentSessionIds: ReadonlySet<string>;
  selectedAgentSessionId: string;
  sessions: AgentSessionSummary[];
  workIndicatorsBySourceSessionId: ReadonlyMap<string, AgentSessionWorkIndicator>;
  onSelectAgentSession: (sessionId: string) => void;
};

export type AttentionSectionTone = "active" | "waiting" | "review";

export type AttentionSectionProps = Omit<
  AgentSessionsAttentionProps,
  "approvalRequestedSourceSessionIds" | "readyForReviewAgentSessionIds"
> & {
  label: string;
  tone: AttentionSectionTone;
};
