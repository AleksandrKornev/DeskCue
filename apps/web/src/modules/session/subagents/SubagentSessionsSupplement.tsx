import type { AgentSessionSummary } from "@deskcue/protocol";

import { SubagentSessionsPanel } from "./SubagentSessionsPanel";
import { useSubagentSessions } from "./useSubagentSessions";

type SubagentSessionsSupplementProps = {
  knownSessions: AgentSessionSummary[];
  parentSessionId: string | null;
  onOpenSubagentSession: (parentSessionId: string, childSessionId: string) => void;
};

export function SubagentSessionsSupplement({
  knownSessions,
  parentSessionId,
  onOpenSubagentSession
}: SubagentSessionsSupplementProps) {
  const subagents = useSubagentSessions(knownSessions, parentSessionId);

  return (
    <SubagentSessionsPanel
      hasMore={subagents.hasMore}
      isLoading={subagents.isLoading}
      loadFailed={subagents.loadFailed}
      parentSessionId={parentSessionId}
      sessions={subagents.sessions}
      onOpenSession={(agentSessionId) => {
        if (!parentSessionId) return;

        onOpenSubagentSession(parentSessionId, agentSessionId);
      }}
      onRetry={subagents.retry}
    />
  );
}
