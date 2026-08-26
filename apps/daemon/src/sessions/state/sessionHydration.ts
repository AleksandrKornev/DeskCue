import { randomUUID } from "node:crypto";

import { codexAdapter, genericCliAdapter } from "@deskcue/adapters";
import type { SessionDetail } from "@deskcue/protocol";
import {
  CODEX_ACTIVE_WRITER_BLOCKED_REASON,
  hasCodexActiveWriterConflict
} from "#agents/codex/session/codexWriterConflict";
import { normalizeSessionLogs } from "#sessions/logs/sessionLogs";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

export type HydratedSessionState = {
  restoredCodexAttachedSessions: number;
  normalizedDetachedSessions: number;
  prunedPersistedSessions: number;
  revivedRunningSessions: number;
  sessions: SessionDetail[];
};

function hasRestorableCodexActiveWriterConflict(session: SessionDetail) {
  if (
    session.inputBlockedReason === CODEX_ACTIVE_WRITER_BLOCKED_REASON &&
    session.promptRecovery?.phase === "not_sent"
  ) {
    return true;
  }

  const requestedAt = session.replyState.requestedAt ?? session.promptRecovery?.requestedAt ?? null;

  return hasCodexActiveWriterConflict(session, { requestedAt });
}

function shouldRestoreCodexAttachedShell(session: SessionDetail) {
  if (session.adapterId !== codexAdapter.id || !session.sourceSessionId) return false;
  if (hasRestorableCodexActiveWriterConflict(session)) return true;
  if (session.exitCode !== null) return false;
  if (session.status === "running") return true;
  if (session.status === "failed") return true;

  return (
    session.status === "stopped" &&
    session.logs.some((log) =>
      log.stream === "system" &&
      (
        log.text.includes("DeskCue daemon restarted. Session is no longer attached") ||
        log.text.includes("DeskCue normalized a detached Codex transport")
      )
    )
  );
}

export function hydratePersistedSessions(sessions: SessionDetail[]): HydratedSessionState {
  let restoredCodexAttachedSessions = 0;
  let revivedRunningSessions = 0;
  let normalizedDetachedSessions = 0;
  let prunedPersistedSessions = 0;
  const hydratedSessions: SessionDetail[] = [];

  for (const session of sessions) {
    const restored = structuredClone(session);

    restored.adapterId = restored.adapterId || genericCliAdapter.id;

    restored.sourceSessionId = restored.sourceSessionId ?? null;
    restored.preview = {
      ...emptyPreview(),
      ...restored.preview,
      artifacts: restored.preview?.artifacts ?? []
    };

    restored.replyState = restored.replyState ?? emptyReplyState();
    restored.promptRecovery = restored.promptRecovery ?? null;
    restored.actionRequest = restored.actionRequest ?? null;
    if (shouldRestoreCodexAttachedShell(restored)) {
      const activeWriterConflict = hasRestorableCodexActiveWriterConflict(restored);

      restoredCodexAttachedSessions += 1;
      restored.status = "read_only";
      restored.finishedAt = restored.finishedAt ?? new Date().toISOString();
      restored.lastActivityAt = new Date().toISOString();
      restored.exitCode = null;
      restored.replyState = emptyReplyState();
      restored.actionRequest = null;
      restored.inputBlockedReason = activeWriterConflict
        ? CODEX_ACTIVE_WRITER_BLOCKED_REASON
        : restored.inputBlockedReason;
      restored.logs = [
        ...restored.logs,
        {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          stream: "system",
          text: activeWriterConflict
            ? `${CODEX_ACTIVE_WRITER_BLOCKED_REASON} DeskCue restored the chat as read-only; the prompt was not sent.\n`
            : "DeskCue restored this Codex chat after daemon restart. The local transport is detached; send a prompt to resume control.\n"
        }
      ];
    } else if (restored.status === "running") {
      revivedRunningSessions += 1;
      restored.status = "stopped";
      restored.finishedAt = restored.finishedAt ?? new Date().toISOString();
      restored.lastActivityAt = new Date().toISOString();
      restored.replyState = emptyReplyState();
      restored.actionRequest = null;
      restored.logs = [
        ...restored.logs,
        {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          stream: "system",
          text: "DeskCue daemon restarted. Session is no longer attached to a running process.\n"
        }
      ];
    }

    if (
      restored.status === "failed" &&
      restored.sourceSessionId &&
      restored.exitCode === null
    ) {
      normalizedDetachedSessions += 1;
      restored.status = "stopped";
      restored.finishedAt = restored.finishedAt ?? new Date().toISOString();
      restored.lastActivityAt = new Date().toISOString();
      restored.replyState = emptyReplyState();
      restored.actionRequest = null;
      restored.logs = [
        ...restored.logs,
        {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          stream: "system",
          text: "DeskCue normalized a detached Codex transport from failed to stopped.\n"
        }
      ];
    }

    const normalizedLogs = normalizeSessionLogs(restored.logs);

    if (normalizedLogs.changed) {
      prunedPersistedSessions += 1;
      restored.logs = normalizedLogs.logs;
    }

    hydratedSessions.push(restored);
  }

  return {
    restoredCodexAttachedSessions,
    normalizedDetachedSessions,
    prunedPersistedSessions,
    revivedRunningSessions,
    sessions: hydratedSessions
  };
}
