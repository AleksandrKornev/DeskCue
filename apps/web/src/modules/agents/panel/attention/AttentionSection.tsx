import clsx from "clsx";
import { useEffect, useState } from "react";

import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";

import { ATTENTION_PREVIEW_LIMIT } from "./constants";
import styles from "./styles.module.scss";
import type { AttentionSectionProps } from "./types";

const EMPTY_READY_FOR_REVIEW_AGENT_SESSION_IDS = new Set<string>();
const SOURCE_SESSION_REFERENCE_EDGE_LENGTH = 10;
const SOURCE_SESSION_REFERENCE_MAX_LENGTH = 24;

function formatSourceSessionReference(sourceSessionId: string) {
  if (sourceSessionId.length <= SOURCE_SESSION_REFERENCE_MAX_LENGTH) return sourceSessionId;

  return [
    sourceSessionId.slice(0, SOURCE_SESSION_REFERENCE_EDGE_LENGTH),
    sourceSessionId.slice(-SOURCE_SESSION_REFERENCE_EDGE_LENGTH)
  ].join("…");
}

function buildSessionReferences(sessions: AttentionSectionProps["sessions"]) {
  const baseReferences = sessions.map((session) => formatSourceSessionReference(session.sourceSessionId));
  const referenceCounts = new Map<string, number>();
  const referenceOccurrences = new Map<string, number>();
  const referencesBySessionId = new Map<string, string>();

  for (const reference of baseReferences) {
    referenceCounts.set(reference, (referenceCounts.get(reference) ?? 0) + 1);
  }

  sessions.forEach((session, index) => {
    const baseReference = baseReferences[index];
    const occurrence = (referenceOccurrences.get(baseReference) ?? 0) + 1;

    referenceOccurrences.set(baseReference, occurrence);
    referencesBySessionId.set(
      session.id,
      referenceCounts.get(baseReference) === 1
        ? baseReference
        : `${baseReference} · ${occurrence}`
    );
  });

  return referencesBySessionId;
}

export function AttentionSection({
  label,
  readyForReviewAgentSessionIds = EMPTY_READY_FOR_REVIEW_AGENT_SESSION_IDS,
  previewLimit = ATTENTION_PREVIEW_LIMIT,
  selectedAgentSessionId,
  sessions,
  tone,
  workIndicatorsBySourceSessionId,
  onSelectAgentSession
}: AttentionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(!selectedAgentSessionId);

  useEffect(() => {
    setIsExpanded(!selectedAgentSessionId);
  }, [selectedAgentSessionId]);

  if (sessions.length === 0) {
    return null;
  }

  const previewSessions = sessions.slice(0, previewLimit);
  const sessionReferences = buildSessionReferences(previewSessions);

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
                  data-chat-list-item-id={session.id}
                  onClick={() => onSelectAgentSession(session.id)}
                  type="button"
                >
                  <span className={styles.attentionCardStatus}>
                    <span aria-hidden="true" className={styles.attentionCardDot} />
                    {readyForReviewAgentSessionIds.has(session.id)
                      ? "Ready for review"
                      : indicator?.label ?? label}
                  </span>
                  <strong className={styles.attentionCardTitle}>{session.title}</strong>
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
                    <span
                      className={styles.attentionCardIdentity}
                      title={`Source session ${sessionReferences.get(session.id)}`}
                    >
                      ID {sessionReferences.get(session.id)}
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
