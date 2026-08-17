import { useMemo } from "react";

import type { AgentSessionDetail, AgentSessionSummary, SessionDetail, SessionSummary } from "@deskcue/protocol";
import { formatManagedSessionSubtitle, formatManagedSessionTitle } from "@models/sessionDisplay";
import { compareSwitchableManagedSessions } from "@modules/session/helpers";

import {
  resolveContextCompactionCount,
  resolveLiveHeaderStatus,
  resolveLiveHeaderStatusLabel
} from "./liveChat/helpers";

export function useManagedSessionLiveChatModel({
  agentSessions,
  agentTranscriptHasMoreById,
  isPromptInFlight,
  loadingMoreAgentTranscriptId,
  managedSessions,
  sessionShell,
  takenOverAgentSession
}: {
  agentSessions: AgentSessionSummary[];
  agentTranscriptHasMoreById: Map<string, boolean>;
  isPromptInFlight: boolean;
  loadingMoreAgentTranscriptId: string;
  managedSessions: SessionSummary[];
  sessionShell: SessionDetail | SessionSummary | null;
  takenOverAgentSession: AgentSessionDetail | null;
}) {
  const assistantDisplayName = takenOverAgentSession?.agentLabel ?? "Assistant";
  const isTakenOverChat = Boolean(sessionShell?.sourceSessionId);
  const liveSessionTitle = formatManagedSessionTitle(sessionShell, takenOverAgentSession);
  const liveSessionSubtitle = formatManagedSessionSubtitle(sessionShell, takenOverAgentSession);
  const activeTakenOverAgentSessionSummary = useMemo(
    () =>
      agentSessions.find(
        (session) =>
          session.id === takenOverAgentSession?.id ||
          (sessionShell?.sourceSessionId &&
            session.sourceSessionId === sessionShell.sourceSessionId)
      ) ?? null,
    [agentSessions, sessionShell?.sourceSessionId, takenOverAgentSession?.id]
  );
  const contextCompactionCount = resolveContextCompactionCount(
    takenOverAgentSession?.contextCompactionCount,
    activeTakenOverAgentSessionSummary?.contextCompactionCount
  );
  const switchableManagedSessions = useMemo(
    () =>
      managedSessions
        .filter((session) => session.status === "running")
        .sort(compareSwitchableManagedSessions),
    [managedSessions]
  );
  const liveChatSessionId = sessionShell?.id ?? "";
  const liveChatSourceSessionId = sessionShell?.sourceSessionId ?? "";
  const liveChatAgentSessionId =
    takenOverAgentSession?.id ??
    (
      sessionShell?.sourceSessionId
        ? `${sessionShell.adapterId}:${sessionShell.sourceSessionId}`
        : undefined
    );
  const liveChatAssetContext = useMemo(
    () =>
      liveChatAgentSessionId || sessionShell?.id
        ? {
            agentSessionId: liveChatAgentSessionId,
            managedSessionId: sessionShell?.id
          }
        : undefined,
    [liveChatAgentSessionId, sessionShell?.id]
  );
  const canLoadMoreAgentTranscript = liveChatAgentSessionId
    ? agentTranscriptHasMoreById.get(liveChatAgentSessionId) !== false
    : false;
  const isMoreAgentTranscriptLoading =
    Boolean(liveChatAgentSessionId) && loadingMoreAgentTranscriptId === liveChatAgentSessionId;
  const liveHeaderStatusLabel = resolveLiveHeaderStatusLabel({
    isPromptInFlight,
    sessionShell,
    takenOverAgentSession
  });
  const liveHeaderStatus = resolveLiveHeaderStatus({
    isPromptInFlight,
    sessionShell,
    takenOverAgentSession
  });

  return {
    assistantDisplayName,
    canLoadMoreAgentTranscript,
    contextCompactionCount,
    isMoreAgentTranscriptLoading,
    isTakenOverChat,
    liveChatAgentSessionId,
    liveChatAssetContext,
    liveChatSessionId,
    liveChatSourceSessionId,
    liveHeaderStatus,
    liveHeaderStatusLabel,
    liveSessionSubtitle,
    liveSessionTitle,
    switchableManagedSessions
  };
}
