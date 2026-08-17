import { useEffect, useRef } from "react";

import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import { getDeskCueRuntime } from "@runtime";

import { shouldAutoRefreshManagedSessionDiff } from "./helpers";
import { buildManagedSessionLoadOptionsForTab } from "./managedSessionLoadOptions";
import type { UseSelectedManagedSessionControllerArgs } from "./types";

export function useSelectedManagedSessionController({
  suppressManagedSessionAutoSelect,
  overview,
  isBootstrapping,
  activeTab,
  selectedWorkspaceId,
  selectedAgentSessionId,
  selectedSessionId,
  selectedSession,
  selectedSessionIdRef,
  setSelectedWorkspaceId,
  setSelectedSessionId,
  setSelectedSession,
  loadSession
}: UseSelectedManagedSessionControllerArgs) {
  const canRefreshGit = getDeskCueRuntime().features.gitRefresh === true;
  const lastAutoDiffRefreshRef = useRef("");
  const activeLoadRef = useRef<{ key: string; token: number } | null>(null);
  const loadTokenRef = useRef(0);
  const validatedLoadKeyRef = useRef("");

  useEffect(() => {
    if (!selectedWorkspaceId && overview.workspaces.length > 0) {
      setSelectedWorkspaceId(overview.workspaces[0].id);
    }

    if (suppressManagedSessionAutoSelect) {
      if (selectedSessionId) {
        setSelectedSessionId("");
      }

      if (selectedSession) {
        setSelectedSession(null);
      }
      return;
    }

    const preferredSession = selectedAgentSessionId
      ? null
      : overview.sessions.find((session) => session.status === "running");

    if (!selectedSessionId) {
      if (preferredSession) {
        setSelectedSessionId(preferredSession.id);
      }
      return;
    }

    const selectedSessionSummary = overview.sessions.find(
      (session) => session.id === selectedSessionId
    );

    if (selectedSessionSummary || selectedSession?.id === selectedSessionId) {
      return;
    }

    if (preferredSession) {
      setSelectedSessionId(preferredSession.id);
      return;
    }
  }, [
    overview.sessions,
    overview.workspaces,
    selectedAgentSessionId,
    selectedSession,
    selectedSession?.id,
    selectedSession?.sourceSessionId,
    selectedSession?.status,
    selectedSessionId,
    selectedWorkspaceId,
    suppressManagedSessionAutoSelect,
    setSelectedSession,
    setSelectedSessionId,
    setSelectedWorkspaceId
  ]);

  useEffect(() => {
    if (isBootstrapping) {
      return;
    }

    if (!selectedSessionId) {
      activeLoadRef.current = null;
      validatedLoadKeyRef.current = "";
      setSelectedSession(null);
      return;
    }

    const loadOptions = buildManagedSessionLoadOptionsForTab(activeTab, {
      silent: true
    });
    const sessionView = loadOptions.sessionView;
    const loadKey = `${selectedSessionId}:${sessionView ?? "detail"}:${loadOptions.debugLogTail ?? ""}`;

    if (
      selectedSession?.id === selectedSessionId &&
      validatedLoadKeyRef.current === loadKey
    ) {
      activeLoadRef.current = null;
      return;
    }

    if (activeLoadRef.current?.key === loadKey) {
      return;
    }

    const activeLoad = {
      key: loadKey,
      token: loadTokenRef.current + 1
    };
    loadTokenRef.current = activeLoad.token;
    activeLoadRef.current = activeLoad;
    loadSession(selectedSessionId, loadOptions).finally(() => {
      if (selectedSessionIdRef.current === selectedSessionId) {
        validatedLoadKeyRef.current = loadKey;
      }
      if (activeLoadRef.current === activeLoad) {
        activeLoadRef.current = null;
      }
    });
  }, [
    activeTab,
    isBootstrapping,
    selectedSession?.id,
    selectedSessionId,
    selectedSessionIdRef,
    loadSession,
    setSelectedSession
  ]);

  useEffect(() => {
    if (!shouldAutoRefreshManagedSessionDiff(
      activeTab,
      selectedSessionId
    ) || !canRefreshGit) {
      lastAutoDiffRefreshRef.current = "";
      return;
    }

    const refreshKey = `${selectedSessionId}:diff`;
    if (lastAutoDiffRefreshRef.current === refreshKey) {
      return;
    }

    lastAutoDiffRefreshRef.current = refreshKey;

    sessionsApi.refreshGitWithMeta(selectedSessionId, {
      view: "diff"
    })
      .then((result) => {
        if (selectedSessionIdRef.current === result.data.id) {
          setSelectedSession(result.data);
        }
      })
      .catch(() => {});
  }, [
    activeTab,
    canRefreshGit,
    selectedSessionId,
    selectedSessionIdRef,
    setSelectedSession
  ]);
}
