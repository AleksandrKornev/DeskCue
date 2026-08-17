import type {
  OverviewResponse,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import {
  isStructurallyEqual,
  isTimestampOlder,
  sortSessionSummariesByActivity
} from "@modules/dashboard/model/store/helpers";

export function mergeOverviewSnapshot(
  current: OverviewResponse,
  incoming: OverviewResponse,
  options: {
    shouldPreserveSession?: (session: SessionSummary) => boolean;
    shouldPreserveWorkspace?: (workspace: WorkspaceSummary) => boolean;
  } = {}
) {
  const currentSessionsById = new Map(
    current.sessions.map((session) => [session.id, session])
  );
  const incomingSessionIds = new Set(incoming.sessions.map((session) => session.id));
  const sessions = incoming.sessions.map((session) => {
    const currentSession = currentSessionsById.get(session.id);
    return currentSession &&
      (
        options.shouldPreserveSession?.(currentSession) === true ||
        isTimestampOlder(session.lastActivityAt, currentSession.lastActivityAt)
      )
      ? currentSession
      : session;
  });

  for (const session of current.sessions) {
    if (
      !incomingSessionIds.has(session.id) &&
      options.shouldPreserveSession?.(session) === true
    ) {
      sessions.push(session);
    }
  }
  sortSessionSummariesByActivity(sessions);

  const incomingWorkspaceIds = new Set(incoming.workspaces.map((workspace) => workspace.id));
  const workspaces = [
    ...incoming.workspaces,
    ...current.workspaces.filter(
      (workspace) =>
        !incomingWorkspaceIds.has(workspace.id) &&
        options.shouldPreserveWorkspace?.(workspace) === true
    )
  ];

  return {
    ...incoming,
    sessions,
    workspaces
  };
}

export function mergeOverviewSessionSummary(
  overview: OverviewResponse,
  summary: SessionSummary
) {
  const existingSummary = overview.sessions.find((session) => session.id === summary.id);
  if (existingSummary && isTimestampOlder(summary.lastActivityAt, existingSummary.lastActivityAt)) {
    return overview;
  }
  if (existingSummary && isStructurallyEqual(existingSummary, summary)) {
    return overview;
  }

  const nextSessions = overview.sessions.some((session) => session.id === summary.id)
    ? overview.sessions.map((session) => (session.id === summary.id ? summary : session))
    : [summary, ...overview.sessions];

  sortSessionSummariesByActivity(nextSessions);
  return {
    ...overview,
    sessions: nextSessions
  };
}

export function touchOverviewSessionActivity(
  overview: OverviewResponse,
  sessionId: string,
  timestamp: string
) {
  const sessionIndex = overview.sessions.findIndex((session) => session.id === sessionId);
  if (sessionIndex === -1) {
    return overview;
  }

  if (isTimestampOlder(timestamp, overview.sessions[sessionIndex].lastActivityAt)) {
    return overview;
  }

  const nextSessions = [...overview.sessions];
  nextSessions[sessionIndex] = {
    ...nextSessions[sessionIndex],
    lastActivityAt: timestamp
  };
  sortSessionSummariesByActivity(nextSessions);
  return {
    ...overview,
    sessions: nextSessions
  };
}

export function addOverviewWorkspaceSummary(
  overview: OverviewResponse,
  summary: WorkspaceSummary
) {
  if (overview.workspaces.some((workspace) => workspace.id === summary.id)) {
    return overview;
  }

  return {
    ...overview,
    workspaces: [summary, ...overview.workspaces]
  };
}
