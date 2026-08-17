import type { AgentSessionSummary } from "@deskcue/protocol";

export function isAgentSessionReviewed(session: AgentSessionSummary) {
  if (!session.reviewedAt) {
    return false;
  }

  const reviewedAt = Date.parse(session.reviewedAt);
  const updatedAt = Date.parse(session.updatedAt);
  return Number.isFinite(reviewedAt) &&
    Number.isFinite(updatedAt) &&
    reviewedAt >= updatedAt;
}
