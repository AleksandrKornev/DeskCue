import { useMemo, useRef } from "react";

import type {
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import { buildDebugLogEntries } from "@models/sessionDisplay";

import { mergeManagedSessionLifecycle } from "./managedSessionShellViewModel";

export function useManagedSessionShellViewModel({
  managedSessions,
  selectedSession,
  selectedSessionId,
  suppressSessionShell = false
}: {
  managedSessions: SessionSummary[];
  selectedSession: SessionDetail | null;
  selectedSessionId: string;
  suppressSessionShell?: boolean;
}) {
  const lastSelectedSessionDetailRef = useRef<SessionDetail | null>(null);
  const selectedSessionSummary =
    selectedSessionId && !suppressSessionShell
      ? managedSessions.find((session) => session.id === selectedSessionId) ?? null
      : null;
  const matchingSessionDetail = !suppressSessionShell && selectedSession?.id === selectedSessionId
    ? selectedSession
    : null;

  if (matchingSessionDetail) {
    lastSelectedSessionDetailRef.current = matchingSessionDetail;
  } else if (!suppressSessionShell && (
    lastSelectedSessionDetailRef.current?.id !== selectedSessionId ||
    !selectedSessionSummary
  )) {
    lastSelectedSessionDetailRef.current = null;
  }

  const retainedSessionDetail = suppressSessionShell
    ? null
    : matchingSessionDetail ?? lastSelectedSessionDetailRef.current;
  const selectedSessionDetail = useMemo(
    () => mergeManagedSessionLifecycle(retainedSessionDetail, selectedSessionSummary),
    [retainedSessionDetail, selectedSessionSummary]
  );

  const activeSelectedSession = selectedSessionDetail?.status === "running" ? selectedSessionDetail : null;

  const debugEntries = useMemo(
    () =>
      selectedSessionDetail
        ? buildDebugLogEntries(selectedSessionDetail.logs, {
            mode: selectedSessionDetail.sourceSessionId ? "taken-over" : "manual"
          })
        : [],
    [selectedSessionDetail]
  );

  const sessionShell = selectedSessionDetail ?? selectedSessionSummary;
  const isSessionShellLoading = !selectedSessionDetail && Boolean(selectedSessionSummary);

  return {
    activeSelectedSession,
    debugEntries,
    isSessionShellLoading,
    selectedSessionDetail,
    sessionShell
  };
}
