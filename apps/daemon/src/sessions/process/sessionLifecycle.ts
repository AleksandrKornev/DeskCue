import type { SessionDetail, SessionStatus } from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import { getExitedSessionStatus } from "./sessionProcess.ts";
import type { RunningChild } from "./sessionProcess.ts";
import { createSessionProcessAutomation } from "./sessionProcessPolicy.ts";

type AttachSessionDataHandlerOptions = {
  adapterId: string;
  child: RunningChild;
  command: string;
  onAppendStderrLog?: (sessionId: string, text: string) => void;
  onAppendStdoutLog: (sessionId: string, text: string) => void;
  onAppendSystemLog: (sessionId: string, text: string) => void;
  sessionId: string;
};

type AttachSessionExitHandlerOptions = {
  child: RunningChild;
  getSession: (sessionId: string) => SessionDetail | null;
  isCurrentChild: (sessionId: string, child: RunningChild) => boolean;
  onAppendSystemLog: (sessionId: string, text: string) => void;
  onFinishSession: (sessionId: string, status: SessionStatus, exitCode: number | null) => void;
  sessionId: string;
};

function resolveFinalExitCode(
  session: SessionDetail,
  status: SessionStatus,
  processExitCode: number | null
) {
  const sourceTurnAlreadyCompleted =
    session.sourceSessionId &&
    session.exitCode === 0 &&
    (
      (session.status === "read_only" && status === "read_only") ||
      (session.status === "done" && status === "done") ||
      (session.status === "stopped" && status === "stopped")
    );

  return sourceTurnAlreadyCompleted ? 0 : processExitCode;
}

export function attachSessionDataHandler({
  adapterId,
  child,
  command,
  onAppendStderrLog,
  onAppendStdoutLog,
  onAppendSystemLog,
  sessionId
}: AttachSessionDataHandlerOptions) {
  const processAutomation = createSessionProcessAutomation({
    adapterId,
    command,
    child,
    onAutomationLog: (text) => onAppendSystemLog(sessionId, text)
  });

  child.onData((chunk, stream) => {
    if (stream === "stderr" && onAppendStderrLog) {
      onAppendStderrLog(sessionId, chunk);
    } else {
      onAppendStdoutLog(sessionId, chunk);
    }

    processAutomation?.handleChunk(chunk);
  });
}

export function attachSessionExitHandler({
  child,
  getSession,
  isCurrentChild,
  onAppendSystemLog,
  onFinishSession,
  sessionId
}: AttachSessionExitHandlerOptions) {
  child.onExit(({ exitCode }) => {
    const current = getSession(sessionId);

    if (!current) return;
    if (!isCurrentChild(sessionId, child)) return;

    const processExitCode = exitCode ?? null;
    const nextStatus = getExitedSessionStatus(current, processExitCode);
    const finalExitCode = resolveFinalExitCode(current, nextStatus, processExitCode);

    onAppendSystemLog(
      sessionId,
      finalExitCode === processExitCode
        ? `Process exited with code ${processExitCode ?? "unknown"}.\n`
        : `Process exited with code ${processExitCode ?? "unknown"} after the source turn was already confirmed complete; preserving the successful session outcome.\n`
    );

    logger.info("Session process exited", {
      sessionId,
      exitCode: finalExitCode,
      processExitCode,
      status: nextStatus
    });

    onFinishSession(sessionId, nextStatus, finalExitCode);
  });
}
