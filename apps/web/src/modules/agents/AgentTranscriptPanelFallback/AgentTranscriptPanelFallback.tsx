import clsx from "clsx";

import { AgentChatBadge, isSubagentChat } from "@components/AgentChatBadge";
import { formatDate } from "@lib/format";
import {
  canContinueAgentSession,
  getUnavailableChatPresentation
} from "@modules/agents/agentSessionAccessPresentation";
import type { AgentSessionsPanelProps } from "@modules/agents/types";
import { useAgentSessionConfirmationGuard } from "@modules/agents/useAgentSessionConfirmationGuard";
import { useCurrentAgentSessionActionGuard } from "@modules/agents/useCurrentAgentSessionActionGuard";

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
  const currentSessionIdRef = useCurrentAgentSessionActionGuard(session?.id ?? null);
  const requestCurrentSessionConfirmation = useAgentSessionConfirmationGuard({
    accessKey: session
      ? [session.attachMode, session.workState, session.agentId, session.originator ?? ""].join(":")
      : "",
    sessionId: session?.id ?? null
  });

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
  const canContinueSourceChat = canContinueAgentSession(session);
  const unavailableChatPresentation = getUnavailableChatPresentation(session);
  const capabilityLabel = isLoading
    ? "Loading chat"
    : canContinueSourceChat
      ? "Ready to continue"
      : unavailableChatPresentation.capabilityLabel;
  const attachedSessionHint = attachedManagedSessionInfo
    ? attachedManagedSessionInfo.status === "running"
      ? attachedViewerCount > 0
        ? `Already open in ${attachedViewerCount === 1 ? "1 DeskCue client" : `${attachedViewerCount} DeskCue clients`}`
        : "A live DeskCue chat is already running"
      : "A DeskCue chat is available"
    : null;
  const actionLabel = attachedManagedSessionId
    ? "Open live chat"
    : canContinueSourceChat
      ? "Continue chat"
      : unavailableChatPresentation.actionLabel;

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
          onClick={async () => {
            const actionSessionId = session.id;

            if (attachedManagedSessionId) {
              onOpenManagedSession(attachedManagedSessionId);
              return;
            }

            if (!canContinueSourceChat) {
              const confirmed = await requestCurrentSessionConfirmation({
                confirmLabel: unavailableChatPresentation.confirmLabel,
                description: unavailableChatPresentation.description,
                title: unavailableChatPresentation.title
              });

              if (!confirmed || currentSessionIdRef.current !== actionSessionId) return;
            }

            if (currentSessionIdRef.current !== actionSessionId) return;

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
              (canContinueSourceChat
                ? "Open the completed chat; sending a follow-up continues it"
                : unavailableChatPresentation.hint)}
        </p>
      </div>
    </div>
  );
}
