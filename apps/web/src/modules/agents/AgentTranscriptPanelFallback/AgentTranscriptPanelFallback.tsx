import clsx from "clsx";

import { AgentChatBadge, isSubagentChat } from "@components/AgentChatBadge";
import { formatDate } from "@lib/format";
import type { AgentSessionsPanelProps } from "@modules/agents/types";

import styles from "./styles.module.scss";

export type AgentTranscriptPanelFallbackProps = {
  attachedManagedSessionId: string | null;
  attachedManagedSessionInfo: AgentSessionsPanelProps["attachedManagedSessionInfo"];
  attaching: boolean;
  isLoading: boolean;
  session: AgentSessionsPanelProps["selectedAgentSession"] | AgentSessionsPanelProps["agentSessions"][number] | null;
  onAttach: () => void;
  onOpenManagedSession: (sessionId: string) => void;
};

export function AgentTranscriptPanelFallback({
  attachedManagedSessionId,
  attachedManagedSessionInfo,
  attaching,
  isLoading,
  session,
  onAttach,
  onOpenManagedSession
}: AgentTranscriptPanelFallbackProps) {
  if (!session) {
    return (
      <div className={clsx(styles.quickDetail, styles.quickDetailLoading)} aria-busy="true">
        <div>
          <strong>Loading chat</strong>
          <span>Fetching local thread metadata</span>
        </div>
        <button className={clsx(styles.button, styles.buttonLoading)} disabled type="button">
          Loading chat...
        </button>
      </div>
    );
  }

  const attachedViewerCount = attachedManagedSessionInfo?.viewerCount ?? 0;
  const capabilityLabel = isLoading
    ? "Loading chat"
    : session.workState === "running"
      ? "Working in Codex"
      : session.attachMode === "resume"
        ? "Ready"
        : "Review chat";
  const attachedSessionHint = attachedManagedSessionInfo
    ? attachedManagedSessionInfo.status === "running"
      ? attachedViewerCount > 0
        ? `Already open in ${attachedViewerCount === 1 ? "1 DeskCue client" : `${attachedViewerCount} DeskCue clients`}`
        : "A live DeskCue chat is already running"
      : "A DeskCue chat is available"
    : null;
  const actionLabel = attachedManagedSessionId
    ? "Open live chat"
    : session.attachMode === "resume"
      ? "Resume chat"
      : "Open review";

  return (
    <div className={clsx(styles.quickDetail, styles.quickDetailStable, isLoading && styles.quickDetailLoading)}>
      <div className={styles.quickDetailMeta}>
        <div>
          <strong>{session.title}</strong>
          <span>{session.workspacePath ?? "No workspace linked to this chat"}</span>
        </div>
      </div>

      <div className={styles.quickDetailMetaRow}>
        {isSubagentChat(session) ? <AgentChatBadge /> : null}
        <span className={styles.sourcePill}>{session.agentLabel}</span>
        <span className={styles.capability}>{capabilityLabel}</span>
        {attachedManagedSessionInfo ? <span className={styles.capability}>DeskCue attached</span> : null}
        <span className={styles.quickDetailDate}>{formatDate(session.updatedAt)}</span>
      </div>

      <div className={styles.quickDetailAction}>
        <button
          className={clsx(styles.button, styles.accentButton, attaching && styles.buttonLoading)}
          disabled={attaching}
          onClick={() => {
            if (attachedManagedSessionId) {
              onOpenManagedSession(attachedManagedSessionId);
              return;
            }

            onAttach();
          }}
          type="button"
        >
          {attaching ? "Opening..." : actionLabel}
        </button>
        <p>
          {attaching
            ? "DeskCue is preparing the local thread"
            : attachedSessionHint ??
              (session.attachMode === "resume"
                ? "Resume starts the local agent process for this chat"
                : "Open a read-only DeskCue review for this chat")}
        </p>
      </div>
    </div>
  );
}
