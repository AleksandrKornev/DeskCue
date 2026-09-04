import { useCallback, useEffect } from "react";

import { useAgentChatDetailResource } from "@modules/dashboard/model/chatDetail/resource/useAgentChatDetailResource";

import {
  resolveSelectedAgentSessionLoadError,
  resolveSelectedAgentSessionTranscriptDetail
} from "./helpers";
import type { UseSelectedAgentSessionControllerArgs } from "./types";

export function useSelectedAgentSessionController({
  suppressAgentSessionAutoSelect,
  activeTab,
  isBootstrapping,
  agentSessions,
  filteredAgentSessions,
  selectedAgentSessionId,
  selectedAgentSession,
  selectedAgentSessionRefreshNonce,
  selectedSession,
  hydratedSelectedAgentSessionIdRef,
  selectedAgentSessionRef,
  incrementSelectedAgentSessionRefreshNonce,
  setSelectedAgentSessionId,
  setSelectedAgentSession,
  updateSelectedAgentSession,
  setIsAgentSessionLoading,
}: UseSelectedAgentSessionControllerArgs) {
  const transcriptDetail = resolveSelectedAgentSessionTranscriptDetail(
    activeTab,
    selectedSession
  );
  const hydrationKey = selectedAgentSessionId
    ? `${selectedAgentSessionId}:${transcriptDetail}`
    : "";
  const shouldLoadSelectedAgentSession =
    !suppressAgentSessionAutoSelect && Boolean(selectedAgentSessionId);
  const { snapshot: selectedAgentSessionSnapshot } = useAgentChatDetailResource({
    activeTab,
    enabled: shouldLoadSelectedAgentSession,
    onDetail: (session, loadedSessionId) => {
      if (loadedSessionId !== selectedAgentSessionId) {
        return;
      }

      hydratedSelectedAgentSessionIdRef.current = hydrationKey;
      setSelectedAgentSession(session ?? null);
    },
    refreshKey: selectedAgentSessionRefreshNonce,
    sessionId: selectedAgentSessionId,
    transcriptDetail
  });

  useEffect(() => {
    const detail = selectedAgentSessionSnapshot.detail;

    if (!detail || detail.id !== selectedAgentSessionId) {
      return;
    }

    hydratedSelectedAgentSessionIdRef.current = hydrationKey;
    setSelectedAgentSession(detail);
  }, [
    hydratedSelectedAgentSessionIdRef,
    hydrationKey,
    selectedAgentSessionId,
    selectedAgentSessionSnapshot.detail,
    setSelectedAgentSession
  ]);

  useEffect(() => {
    if (suppressAgentSessionAutoSelect) {
      if (selectedAgentSession) {
        setSelectedAgentSession(null);
      }

      hydratedSelectedAgentSessionIdRef.current = "";
      setIsAgentSessionLoading(false);
      return;
    }

    if (selectedAgentSessionId || agentSessions.length === 0) {
      return;
    }

    const matchingAgentSession = selectedSession?.sourceSessionId
      ? agentSessions.find(
          (session) =>
            session.sourceSessionId === selectedSession.sourceSessionId &&
            session.agentId === selectedSession.adapterId
        ) ?? null
      : null;

    if (matchingAgentSession) {
      setSelectedAgentSessionId(matchingAgentSession.id);
    }
  }, [
    agentSessions,
    hydratedSelectedAgentSessionIdRef,
    selectedAgentSession,
    selectedAgentSessionId,
    selectedSession?.adapterId,
    selectedSession?.sourceSessionId,
    suppressAgentSessionAutoSelect,
    setIsAgentSessionLoading,
    setSelectedAgentSession,
    setSelectedAgentSessionId
  ]);

  useEffect(() => {
    if (isBootstrapping && !selectedAgentSessionId) {
      return;
    }

    if (!selectedAgentSessionId) {
      hydratedSelectedAgentSessionIdRef.current = "";
      setSelectedAgentSession(null);
      setIsAgentSessionLoading(false);
      return;
    }

    if (
      hydratedSelectedAgentSessionIdRef.current === hydrationKey &&
      selectedAgentSessionRef.current?.id === selectedAgentSessionId
    ) {
      setIsAgentSessionLoading(false);
      return;
    }

    updateSelectedAgentSession((current) =>
      current?.id === selectedAgentSessionId ? current : null
    );

    setIsAgentSessionLoading(
      selectedAgentSessionSnapshot.status === "idle" ||
        selectedAgentSessionSnapshot.status === "loading" ||
        selectedAgentSessionSnapshot.status === "refreshing"
    );
  }, [
    hydratedSelectedAgentSessionIdRef,
    hydrationKey,
    isBootstrapping,
    selectedAgentSessionId,
    selectedAgentSessionSnapshot.status,
    selectedAgentSessionRef,
    setIsAgentSessionLoading,
    setSelectedAgentSession,
    updateSelectedAgentSession
  ]);

  useEffect(() => {
    if (isBootstrapping || filteredAgentSessions.length === 0 || !selectedAgentSessionId) {
      return;
    }

    if (!agentSessions.some((session) => session.id === selectedAgentSessionId)) {
      return;
    }

    if (!filteredAgentSessions.some((session) => session.id === selectedAgentSessionId)) {
      setSelectedAgentSessionId(filteredAgentSessions[0]?.id ?? "");
    }
  }, [
    agentSessions,
    filteredAgentSessions,
    isBootstrapping,
    selectedAgentSessionId,
    setSelectedAgentSessionId
  ]);

  const refreshSelectedAgentSession = useCallback(() => {
    hydratedSelectedAgentSessionIdRef.current = "";
    setSelectedAgentSession(null);
    setIsAgentSessionLoading(true);
    incrementSelectedAgentSessionRefreshNonce();
  }, [
    hydratedSelectedAgentSessionIdRef,
    incrementSelectedAgentSessionRefreshNonce,
    setIsAgentSessionLoading,
    setSelectedAgentSession
  ]);

  return {
    refreshSelectedAgentSession,
    selectedAgentSessionLoadError: resolveSelectedAgentSessionLoadError(
      shouldLoadSelectedAgentSession,
      selectedAgentSessionId,
      selectedAgentSessionSnapshot
    )
  };
}
