import { AttentionSection } from "./AttentionSection";
import { ATTENTION_PREVIEW_LIMIT } from "./constants";
import { buildAttentionSessionGroups } from "./helpers";
import styles from "./styles.module.scss";
import type { AgentSessionsAttentionProps } from "./types";

export function AgentSessionsAttention({
  approvalRequestedSourceSessionKeys,
  countIsLowerBound = false,
  readyForReviewAgentSessionIds,
  selectedAgentSessionId,
  sessions,
  previewLimit = ATTENTION_PREVIEW_LIMIT,
  workIndicatorsBySourceSessionKey,
  onSelectAgentSession
}: AgentSessionsAttentionProps) {
  const { activeAgents, approvalRequests, newResults } = buildAttentionSessionGroups({
    approvalRequestedSourceSessionKeys,
    readyForReviewAgentSessionIds,
    sessions,
    workIndicatorsBySourceSessionKey
  });

  if (approvalRequests.length === 0 && newResults.length === 0 && activeAgents.length === 0) {
    return null;
  }

  return (
    <div className={styles.attentionSections}>
      <AttentionSection
        countIsLowerBound={countIsLowerBound}
        label="Approval required"
        previewLimit={previewLimit}
        sessions={approvalRequests}
        selectedAgentSessionId={selectedAgentSessionId}
        statusLabel="Approval required"
        tone="waiting"
        workIndicatorsBySourceSessionKey={workIndicatorsBySourceSessionKey}
        onSelectAgentSession={onSelectAgentSession}
      />
      <AttentionSection
        countIsLowerBound={countIsLowerBound}
        label="New results"
        previewLimit={previewLimit}
        sessions={newResults}
        selectedAgentSessionId={selectedAgentSessionId}
        statusLabel="New result"
        tone="review"
        workIndicatorsBySourceSessionKey={workIndicatorsBySourceSessionKey}
        onSelectAgentSession={onSelectAgentSession}
      />
      <AttentionSection
        countIsLowerBound={countIsLowerBound}
        fallbackStatusLabel="Running"
        label="Active agents"
        previewLimit={previewLimit}
        sessions={activeAgents}
        selectedAgentSessionId={selectedAgentSessionId}
        tone="active"
        workIndicatorsBySourceSessionKey={workIndicatorsBySourceSessionKey}
        onSelectAgentSession={onSelectAgentSession}
      />
    </div>
  );
}
