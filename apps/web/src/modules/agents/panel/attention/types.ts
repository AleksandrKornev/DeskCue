import type { AgentSessionSummary } from "@deskcue/protocol";
import type { AgentSessionWorkIndicator } from "@modules/agents/types";

export type AgentSessionsAttentionProps = {
  approvalRequestedSourceSessionKeys: ReadonlySet<string>;
  countIsLowerBound?: boolean;
  readyForReviewAgentSessionIds: ReadonlySet<string>;
  selectedAgentSessionId: string;
  sessions: AgentSessionSummary[];
  previewLimit?: number;
  workIndicatorsBySourceSessionKey: ReadonlyMap<string, AgentSessionWorkIndicator>;
  onSelectAgentSession: (sessionId: string) => void;
};

export type AttentionSectionTone = "active" | "waiting" | "review";

export type AttentionSectionProps = Omit<
  AgentSessionsAttentionProps,
  | "approvalRequestedSourceSessionKeys"
  | "previewLimit"
  | "readyForReviewAgentSessionIds"
> & {
  fallbackStatusLabel?: string;
  label: string;
  previewLimit?: number;
  statusLabel?: string;
  tone: AttentionSectionTone;
};
