import { AttentionSection } from "./AttentionSection";
import { ATTENTION_PREVIEW_LIMIT } from "./constants";
import { buildAttentionSessionGroups } from "./helpers";
import styles from "./styles.module.scss";
import type { AgentSessionsAttentionProps } from "./types";

export function AgentSessionsAttention({
  approvalRequestedSourceSessionIds,
  readyForReviewAgentSessionIds,
  selectedAgentSessionId,
  sessions,
  previewLimit = ATTENTION_PREVIEW_LIMIT,
  workIndicatorsBySourceSessionId,
  onSelectAgentSession
}: AgentSessionsAttentionProps) {
  const { activeAgents, needsAttention } = buildAttentionSessionGroups({
    approvalRequestedSourceSessionIds,
    readyForReviewAgentSessionIds,
    sessions,
    workIndicatorsBySourceSessionId
  });

  if (needsAttention.length === 0 && activeAgents.length === 0) {
    return null;
  }

  return (
    <div className={styles.attentionSections}>
      <AttentionSection
        label="Needs attention"
        readyForReviewAgentSessionIds={readyForReviewAgentSessionIds}
        previewLimit={previewLimit}
        sessions={needsAttention}
        selectedAgentSessionId={selectedAgentSessionId}
        tone="waiting"
        workIndicatorsBySourceSessionId={workIndicatorsBySourceSessionId}
        onSelectAgentSession={onSelectAgentSession}
      />
      <AttentionSection
        label="Active agents"
        readyForReviewAgentSessionIds={readyForReviewAgentSessionIds}
        previewLimit={previewLimit}
        sessions={activeAgents}
        selectedAgentSessionId={selectedAgentSessionId}
        tone="active"
        workIndicatorsBySourceSessionId={workIndicatorsBySourceSessionId}
        onSelectAgentSession={onSelectAgentSession}
      />
    </div>
  );
}
