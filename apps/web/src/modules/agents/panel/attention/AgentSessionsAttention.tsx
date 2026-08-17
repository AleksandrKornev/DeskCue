import { AttentionSection } from "./AttentionSection";
import styles from "./styles.module.scss";
import type { AgentSessionsAttentionProps } from "./types";

export function AgentSessionsAttention({
  approvalRequestedSourceSessionIds,
  readyForReviewAgentSessionIds,
  selectedAgentSessionId,
  sessions,
  workIndicatorsBySourceSessionId,
  onSelectAgentSession
}: AgentSessionsAttentionProps) {
  const needsYou = sessions.filter((session) =>
    approvalRequestedSourceSessionIds.has(session.sourceSessionId)
  );
  const running = sessions.filter(
    (session) =>
      workIndicatorsBySourceSessionId.get(session.sourceSessionId)?.tone === "active" ||
      session.workState === "running"
  );
  const readyForReview = sessions.filter((session) => readyForReviewAgentSessionIds.has(session.id));

  if (needsYou.length === 0 && running.length === 0 && readyForReview.length === 0) {
    return null;
  }

  return (
    <div className={styles.attentionSections}>
      <AttentionSection
        label="Needs you"
        sessions={needsYou}
        selectedAgentSessionId={selectedAgentSessionId}
        tone="waiting"
        workIndicatorsBySourceSessionId={workIndicatorsBySourceSessionId}
        onSelectAgentSession={onSelectAgentSession}
      />
      <AttentionSection
        label="Running"
        sessions={running}
        selectedAgentSessionId={selectedAgentSessionId}
        tone="active"
        workIndicatorsBySourceSessionId={workIndicatorsBySourceSessionId}
        onSelectAgentSession={onSelectAgentSession}
      />
      <AttentionSection
        label="Finished"
        sessions={readyForReview}
        selectedAgentSessionId={selectedAgentSessionId}
        tone="review"
        workIndicatorsBySourceSessionId={workIndicatorsBySourceSessionId}
        onSelectAgentSession={onSelectAgentSession}
      />
    </div>
  );
}
