import clsx from "clsx";
import { useState } from "react";

import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";

import { ATTENTION_PREVIEW_LIMIT } from "./constants";
import styles from "./styles.module.scss";
import type { AttentionSectionProps } from "./types";

export function AttentionSection({
  label,
  selectedAgentSessionId,
  sessions,
  tone,
  workIndicatorsBySourceSessionId,
  onSelectAgentSession
}: AttentionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (sessions.length === 0) {
    return null;
  }

  const previewSessions = sessions.slice(0, ATTENTION_PREVIEW_LIMIT);

  return (
    <section className={clsx(styles.attentionSection, styles[`attentionSection_${tone}`])}>
      <button
        aria-expanded={isExpanded}
        className={styles.attentionSectionHeader}
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        <strong>{label}</strong>
        <span className={styles.attentionSectionToggle}>
          <span className={styles.attentionSectionCount}>{sessions.length}</span>
          <span aria-hidden="true" className={styles.attentionSectionChevron} />
        </span>
      </button>
      {isExpanded ? (
        <>
          <div className={styles.attentionCards}>
            {previewSessions.map((session) => {
              const indicator = workIndicatorsBySourceSessionId.get(session.sourceSessionId);

              return (
                <button
                  key={session.id}
                  className={clsx(
                    styles.attentionCard,
                    session.id === selectedAgentSessionId && styles.attentionCardSelected
                  )}
                  onClick={() => onSelectAgentSession(session.id)}
                  type="button"
                >
                  <span className={styles.attentionCardStatus}>
                    <span aria-hidden="true" className={styles.attentionCardDot} />
                    {tone === "review" ? "Finished" : indicator?.label ?? label}
                  </span>
                  <strong>{session.title}</strong>
                  <span className={styles.attentionCardContext}>
                    <span
                      className={styles.attentionCardRuntimePill}
                      data-attention-runtime-icon={session.agentId}
                    >
                      <AgentRuntimeIcon runtimeId={session.agentId} />
                      {session.agentLabel}
                    </span>
                    <span className={styles.attentionCardWorkspace}>
                      {session.workspaceName ?? "No workspace"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {sessions.length > previewSessions.length ? (
            <p className={styles.attentionSectionMore}>
              +{sessions.length - previewSessions.length} more in the list
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
