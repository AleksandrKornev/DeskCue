import { useMemo } from "react";

import type { AgentSessionDetail, AgentSessionSummary, SessionDetail, SessionSummary } from "@deskcue/protocol";
import { formatManagedSessionSubtitle, formatManagedSessionTitle } from "@models/sessionDisplay";
import { compareSwitchableManagedSessions } from "@modules/session/helpers";

import {
  findManagedSourceSessionSummary,
  resolveContextCompactionCount,
  resolveLiveHeaderStatus,
  resolveLiveHeaderStatusLabel,
  resolveLiveSourceState
} from "./liveChat/helpers";

export function useManagedSessionLiveChatModel({
  agentSessions,
  agentTranscriptHasMoreById,
  hasCompletedManagedPrompt,
  isPromptInFlight,
  loadingMoreAgentTranscriptId,
  managedSessions,
  sessionShell,
  takenOverAgentSession
}: {
  agentSessions: AgentSessionSummary[];
  agentTranscriptHasMoreById: Map<string, boolean>;
  hasCompletedManagedPrompt: boolean;
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
      findManagedSourceSessionSummary(
        agentSessions,
        sessionShell,
        takenOverAgentSession
      ),
    [agentSessions, sessionShell, takenOverAgentSession]
  );
  const contextCompactionCount = resolveContextCompactionCount(
    takenOverAgentSession?.contextCompactionCount,
    activeTakenOverAgentSessionSummary?.contextCompactionCount
  );
  const liveSourceState = resolveLiveSourceState(
    takenOverAgentSession,
    activeTakenOverAgentSessionSummary
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
    hasCompletedManagedPrompt,
    isPromptInFlight,
    sessionShell,
    takenOverAgentSession: liveSourceState
  });
  const liveHeaderStatus = resolveLiveHeaderStatus({
    hasCompletedManagedPrompt,
    isPromptInFlight,
    sessionShell,
    takenOverAgentSession: liveSourceState
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
