import type { AgentSessionSummary } from "@deskcue/protocol";
import type { AgentSessionWorkIndicator } from "@modules/agents/types";

type BuildAttentionSessionGroupsArgs = {
  approvalRequestedSourceSessionIds: ReadonlySet<string>;
  readyForReviewAgentSessionIds: ReadonlySet<string>;
  sessions: AgentSessionSummary[];
  workIndicatorsBySourceSessionId: ReadonlyMap<string, AgentSessionWorkIndicator>;
};

export function isAgentSessionReviewed(session: AgentSessionSummary) {
  if (!session.reviewedAt) return false;

  const reviewedAt = Date.parse(session.reviewedAt);
  const updatedAt = Date.parse(session.updatedAt);

  return Number.isFinite(reviewedAt) &&
    Number.isFinite(updatedAt) &&
    reviewedAt >= updatedAt;
}

export function buildAttentionSessionGroups({
  approvalRequestedSourceSessionIds,
  readyForReviewAgentSessionIds,
  sessions,
  workIndicatorsBySourceSessionId
}: BuildAttentionSessionGroupsArgs) {
  const needsAttention = sessions.filter((session) =>
    approvalRequestedSourceSessionIds.has(session.sourceSessionId) ||
    readyForReviewAgentSessionIds.has(session.id)
  );
  const needsAttentionIds = new Set(needsAttention.map((session) => session.id));
  const activeAgents = sessions.filter(
    (session) =>
      !needsAttentionIds.has(session.id) &&
      (
        workIndicatorsBySourceSessionId.get(session.sourceSessionId)?.tone === "active" ||
        session.workState === "running"
      )
  );

  return { activeAgents, needsAttention };
}
