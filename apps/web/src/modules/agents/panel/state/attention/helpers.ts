import type { AgentSessionSummary } from "@deskcue/protocol";

import { ATTENTION_AGENT_SESSION_LIMIT } from "./constants";

function isTimestampOlder(incoming: string, current: string) {
  const incomingTimestamp = Date.parse(incoming);
  const currentTimestamp = Date.parse(current);
  return Number.isFinite(incomingTimestamp) && Number.isFinite(currentTimestamp)
    ? incomingTimestamp < currentTimestamp
    : incoming < current;
}

export function mergeAttentionSessions(
  current: AgentSessionSummary[],
  incoming: AgentSessionSummary[]
) {
  const byId = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) {
    const existing = byId.get(session.id);
    if (
      existing &&
      isTimestampOlder(session.updatedAt, existing.updatedAt)
    ) {
      continue;
    }
    byId.set(session.id, session);
  }

  return Array.from(byId.values())
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, ATTENTION_AGENT_SESSION_LIMIT);
}
