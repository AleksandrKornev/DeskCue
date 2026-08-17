import type { SessionDetail, SessionStatus } from "@deskcue/protocol";
import { logger } from "#infrastructure/logging/logger";

import { getExitedSessionStatus } from "./sessionProcess.ts";
import type { RunningChild } from "./sessionProcess.ts";
import { createSessionProcessAutomation } from "./sessionProcessPolicy.ts";

type AttachSessionDataHandlerOptions = {
  adapterId: string;
  child: RunningChild;
  command: string;
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

export function attachSessionDataHandler({
  adapterId,
  child,
  command,
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

  child.onData((chunk) => {
    onAppendStdoutLog(sessionId, chunk);
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
    if (!current) {
      return;
    }

    if (!isCurrentChild(sessionId, child)) {
      return;
    }

    const normalizedExitCode = exitCode ?? null;
    const nextStatus = getExitedSessionStatus(current, normalizedExitCode);

    onAppendSystemLog(
      sessionId,
      `Process exited with code ${normalizedExitCode ?? "unknown"}.\n`
    );
    logger.info("Session process exited", {
      sessionId,
      exitCode: normalizedExitCode,
      status: nextStatus
    });
    onFinishSession(sessionId, nextStatus, normalizedExitCode);
  });
}
