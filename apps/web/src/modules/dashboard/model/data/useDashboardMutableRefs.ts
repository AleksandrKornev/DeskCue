import { useEffect, useRef } from "react";

import type { UseDashboardMutableRefsArgs } from "./types";

export function useDashboardMutableRefs({
  activeTab,
  agentSessions,
  overview,
  runtimes,
  selectedAgentSession,
  selectedAgentSessionId,
  selectedSession,
  selectedSessionId
}: UseDashboardMutableRefsArgs) {
  const hydratedSelectedAgentSessionIdRef = useRef("");
  const selectedAgentSessionIdRef = useRef(selectedAgentSessionId);
  const selectedAgentSessionRef = useRef(selectedAgentSession);
  const selectedSessionIdRef = useRef(selectedSessionId);
  const selectedSessionSelectionEpochRef = useRef(0);
  const selectedSessionRef = useRef(selectedSession);
  const overviewRef = useRef(overview);
  const agentSessionsRef = useRef(agentSessions);
  const runtimesRef = useRef(runtimes);
  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    selectedAgentSessionIdRef.current = selectedAgentSessionId;
  }, [selectedAgentSessionId]);

  useEffect(() => {
    if (selectedSessionIdRef.current !== selectedSessionId) {
      selectedSessionSelectionEpochRef.current += 1;
    }

    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    selectedAgentSessionRef.current = selectedAgentSession;
  }, [selectedAgentSession]);

  useEffect(() => {
    overviewRef.current = overview;
  }, [overview]);

  useEffect(() => {
    agentSessionsRef.current = agentSessions;
  }, [agentSessions]);

  useEffect(() => {
    runtimesRef.current = runtimes;
  }, [runtimes]);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
  }, [selectedSession]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  return {
    activeTabRef,
    agentSessionsRef,
    hydratedSelectedAgentSessionIdRef,
    overviewRef,
    runtimesRef,
    selectedAgentSessionIdRef,
    selectedAgentSessionRef,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    selectedSessionRef
  };
}
