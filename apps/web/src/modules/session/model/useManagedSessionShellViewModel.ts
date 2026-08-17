import { useMemo, useRef } from "react";

import type {
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";
import { buildDebugLogEntries } from "@models/sessionDisplay";

export function useManagedSessionShellViewModel({
  managedSessions,
  selectedSession,
  selectedSessionId
}: {
  managedSessions: SessionSummary[];
  selectedSession: SessionDetail | null;
  selectedSessionId: string;
}) {
  const lastSelectedSessionDetailRef = useRef<SessionDetail | null>(null);
  const selectedSessionSummary =
    selectedSessionId
      ? managedSessions.find((session) => session.id === selectedSessionId) ?? null
      : null;
  const matchingSessionDetail = selectedSession?.id === selectedSessionId ? selectedSession : null;

  if (matchingSessionDetail) {
    lastSelectedSessionDetailRef.current = matchingSessionDetail;
  } else if (
    lastSelectedSessionDetailRef.current?.id !== selectedSessionId ||
    !selectedSessionSummary
  ) {
    lastSelectedSessionDetailRef.current = null;
  }

  const selectedSessionDetail = matchingSessionDetail ?? lastSelectedSessionDetailRef.current;
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
