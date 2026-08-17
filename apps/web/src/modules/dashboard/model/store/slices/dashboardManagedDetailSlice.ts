import type {
  SessionDetail,
  SessionLogLine,
  SessionSummary
} from "@deskcue/protocol";
import {
  boundLiveSessionDetail,
  boundLiveSessionLogs
} from "@models/bounds/sessionDetailBounds";
import {
  hasSameObjectFields,
  isTimestampOlder
} from "@modules/dashboard/model/store/helpers";

export type DashboardManagedDetailState = {
  previewPort: string;
  selectedSession: SessionDetail | null;
  selectedSessionId: string;
  selectedWorkspaceId: string;
};

export type ManagedSessionDetailView = "chat" | "debug" | "diff";

function readPreviewPort(session: SessionDetail | null) {
  return session?.preview?.port === null || session?.preview?.port === undefined
    ? ""
    : String(session.preview.port);
}

export function setSelectedSession(
  state: DashboardManagedDetailState,
  value: SessionDetail | null
) {
  const previousSession = state.selectedSession;
  const previousSessionId = previousSession?.id ?? null;
  const previousPreviewPort = readPreviewPort(previousSession);
  if (
    value &&
    previousSession?.id === value.id &&
    isTimestampOlder(value.lastActivityAt, previousSession.lastActivityAt)
  ) {
    state.selectedSession = boundLiveSessionDetail({
      ...previousSession,
      preview: value.preview
    });
    if (state.previewPort === previousPreviewPort) {
      state.previewPort = readPreviewPort(value);
    }
    return;
  }
  state.selectedSession = value ? boundLiveSessionDetail(value) : value;

  if (!value) {
    state.previewPort = "";
  } else if (value.id !== previousSessionId || state.previewPort === previousPreviewPort) {
    state.previewPort = readPreviewPort(value);
  }
}

function mergeSessionLogs(current: SessionLogLine[], incoming: SessionLogLine[]) {
  if (incoming.length === 0) {
    return current;
  }

  const logsById = new Map(current.map((log) => [log.id, log]));
  incoming.forEach((log) => logsById.set(log.id, log));

  return boundLiveSessionLogs(
    [...logsById.values()].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp)
    )
  );
}

export function mergeSelectedSessionView(
  state: DashboardManagedDetailState,
  value: SessionDetail,
  view: ManagedSessionDetailView
) {
  const current = state.selectedSession;
  if (!current || current.id !== value.id) {
    setSelectedSession(state, value);
    return;
  }

  const latestDetail = isTimestampOlder(value.lastActivityAt, current.lastActivityAt)
    ? current
    : value;
  const previousPreviewPort = readPreviewPort(current);
  const logs = view === "debug"
    ? mergeSessionLogs(current.logs, value.logs)
    : current.logs;
  const inputHistory = view === "debug" && value.inputHistory.length >= current.inputHistory.length
    ? value.inputHistory
    : current.inputHistory;
  const git = view === "diff"
    ? isTimestampOlder(value.git.lastUpdatedAt, current.git.lastUpdatedAt)
      ? current.git
      : value.git
    : {
        ...latestDetail.git,
        // Chat and Debug deliberately omit the potentially large diff. Keep
        // the independently hydrated Diff projection until another Diff load
        // replaces it.
        diff: current.git.diff
      };

  state.selectedSession = boundLiveSessionDetail({
    ...latestDetail,
    git,
    inputHistory,
    logs,
    preview: value.preview
  });
  if (state.previewPort === previousPreviewPort) {
    state.previewPort = readPreviewPort(value);
  }
}

export function mergeSelectedSessionSummary(
  state: DashboardManagedDetailState,
  summary: SessionSummary,
  options?: { includePreview?: boolean }
) {
  if (!state.selectedSession || state.selectedSession.id !== summary.id) {
    return;
  }

  if (isTimestampOlder(summary.lastActivityAt, state.selectedSession.lastActivityAt)) {
    return;
  }

  if (hasSameObjectFields(state.selectedSession, summary)) {
    return;
  }

  const previousPreviewPort = readPreviewPort(state.selectedSession);
  const preview = options?.includePreview ? summary.preview : state.selectedSession.preview;
  state.selectedSession = {
    ...state.selectedSession,
    ...summary,
    preview,
    logs: state.selectedSession.logs,
    inputHistory: state.selectedSession.inputHistory
  };
  if (options?.includePreview && state.previewPort === previousPreviewPort) {
    state.previewPort = readPreviewPort(state.selectedSession);
  }
}

export function appendSelectedSessionLogs(
  state: DashboardManagedDetailState,
  sessionId: string,
  logs: SessionLogLine[]
) {
  if (!state.selectedSession || state.selectedSession.id !== sessionId || logs.length === 0) {
    return;
  }

  const knownLogIds = new Set(state.selectedSession.logs.map((log) => log.id));
  const freshLogs = logs.filter((log) => !knownLogIds.has(log.id));
  if (freshLogs.length === 0) {
    return;
  }

  const latestTimestamp = freshLogs.reduce(
    (latest, log) => isTimestampOlder(latest, log.timestamp) ? log.timestamp : latest,
    state.selectedSession.lastActivityAt
  );
  state.selectedSession = {
    ...state.selectedSession,
    logs: boundLiveSessionLogs([...state.selectedSession.logs, ...freshLogs]),
    lastActivityAt: latestTimestamp
  };
}
