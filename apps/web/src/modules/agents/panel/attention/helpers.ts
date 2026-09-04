import type { AgentSessionSummary } from "@deskcue/protocol";
import { getSourceSessionKey } from "@models/agentChatWorkState";
import type { AgentSessionWorkIndicator } from "@modules/agents/types";

type BuildAttentionSessionGroupsArgs = {
  approvalRequestedSourceSessionKeys: ReadonlySet<string>;
  readyForReviewAgentSessionIds: ReadonlySet<string>;
  sessions: AgentSessionSummary[];
  workIndicatorsBySourceSessionKey: ReadonlyMap<string, AgentSessionWorkIndicator>;
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
  approvalRequestedSourceSessionKeys,
  readyForReviewAgentSessionIds,
  sessions,
  workIndicatorsBySourceSessionKey
}: BuildAttentionSessionGroupsArgs) {
  const approvalRequests = sessions.filter((session) =>
    approvalRequestedSourceSessionKeys.has(
      getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
    )
  );
  const approvalRequestIds = new Set(approvalRequests.map((session) => session.id));
  const newResults = sessions.filter(
    (session) =>
      !session.subagent &&
      !approvalRequestIds.has(session.id) &&
      readyForReviewAgentSessionIds.has(session.id)
  );
  const attentionIds = new Set([
    ...approvalRequests.map((session) => session.id),
    ...newResults.map((session) => session.id)
  ]);
  const activeAgents = sessions.filter(
    (session) =>
      !session.subagent &&
      !attentionIds.has(session.id) &&
      (
        workIndicatorsBySourceSessionKey.get(
          getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
        )?.tone === "active" ||
        session.workState === "running"
      )
  );

  return { activeAgents, approvalRequests, newResults };
}
