import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { logger } from "#infrastructure/logging/logger";
import { emptyReplyState } from "#sessions/model/sessionDefaults";
import {
  attachSessionDataHandler,
  attachSessionExitHandler
} from "#sessions/process/sessionLifecycle";
import type { RunningChild } from "#sessions/process/sessionProcess";

import { buildCodexResumeTransport } from "./codexTransport.ts";
import { runSourcePromptProcessLifecycle } from "../../sourceAgentPromptProcess.ts";
import type { SourcePromptProcessCallbacks } from "../../sourceAgentPromptProcess.ts";

type CodexRestartReason = "prompt" | "interrupt";

type RestartCodexTransportCallbacks = SourcePromptProcessCallbacks & {
  getChild: (sessionId: string) => RunningChild | undefined;
  getWorkspace: (workspaceId: string) => WorkspaceSummary | null;
  killChild: (
    sessionId: string,
    child: RunningChild | undefined,
    reason: string
  ) => Promise<void>;
};

export async function sendCodexPrompt(input: {
  child: RunningChild | undefined;
  restart: (options: { prompt?: string; reason: CodexRestartReason }) => Promise<SessionDetail>;
  prompt: string;
  session: SessionDetail;
}) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new AppError("invalid_input", "Prompt is empty.");

  return input.restart({
    prompt,
    reason: "prompt"
  });
}

function sendCodexInterrupt(child: RunningChild) {
  // `codex resume` opens a TUI before it accepts keyboard input. Sending Escape
  // immediately after spawning is often lost, so retry during that short startup
  // window. Every write is best effort: once cancellation succeeds the PTY can
  // legitimately close before the later retries.
  for (const delayMs of [300, 750, 1_500]) {
    const interruptTimer = setTimeout(() => {
      try {
        child.write("\x1b");
      } catch {
        // The transport may already have accepted cancellation or exited.
      }
    }, delayMs);
    interruptTimer.unref?.();
  }
}

function canRestartDetachedCodexShell(
  session: SessionDetail,
  reason: CodexRestartReason
) {
  if (!session.sourceSessionId) return false;

  if (reason === "interrupt") return session.status === "read_only" || session.status === "running";

  return session.status === "read_only" || session.status === "stopped" || session.status === "running";
}

export async function restartCodexTransport(
  callbacks: RestartCodexTransportCallbacks,
  session: SessionDetail,
  options: {
    prompt?: string;
    reason: CodexRestartReason;
  }
) {
  const workspace = callbacks.getWorkspace(session.workspaceId);
  const currentChild = callbacks.getChild(session.id);
  const prompt = options.prompt?.trim();
  const requestedAt = new Date().toISOString();

  if (!workspace || !session.sourceSessionId) {
    throw new AppError("not_accepting_input", "Codex session is not accepting input.");
  }

  if (!currentChild && !canRestartDetachedCodexShell(session, options.reason)) {
    throw new AppError("not_accepting_input", "Codex session is not accepting input.");
  }

  if (options.reason === "prompt" && !prompt) throw new AppError("invalid_input", "Prompt is empty.");

  const { command, spawnSpec } = await buildCodexResumeTransport({
    sourceSessionId: session.sourceSessionId,
    prompt
  });

  if (options.reason === "prompt") {
    const promptText = prompt as string;
    const updatedSession = await runSourcePromptProcessLifecycle(callbacks, {
      beforeSessionCommit: async () => {
        await callbacks.killChild(session.id, currentChild, "restart");
      },
      command,
      env: {},
      logStarted: (child) => {
        logger.info("Codex transport restarted for prompt", {
          sessionId: session.id,
          sourceSessionId: session.sourceSessionId,
          pid: child.pid ?? null,
          cwd: workspace.path,
          inputLength: promptText.length,
          reason: options.reason
        });
      },
      prompt: promptText,
      requestedAt,
      session,
      spawnSpec,
      startedMessage: "DeskCue restarted the Codex transport for the next prompt.\n",
      workspace
    });
    if (!updatedSession) throw new AppError("not_found", "Session not found.");
    return updatedSession;
  }

  const nextChild = callbacks.spawnProcess({
    command,
    cwd: workspace.path,
    env: {},
    sessionId: session.id,
    spawnSpec
  });
  sendCodexInterrupt(nextChild);

  attachSessionDataHandler({
    adapterId: session.adapterId,
    child: nextChild,
    command,
    onAppendStdoutLog: callbacks.appendStdoutLog,
    onAppendSystemLog: callbacks.appendSystemLog,
    sessionId: session.id
  });
  callbacks.stopGitPolling(session.id);

  logger.info("Codex transport restarted for prompt", {
    sessionId: session.id,
    sourceSessionId: session.sourceSessionId,
    pid: nextChild.pid ?? null,
    cwd: workspace.path,
    inputLength: prompt?.length ?? 0,
    reason: options.reason
  });
  callbacks.startGitPolling(session.id, workspace.path);

  await callbacks.killChild(session.id, currentChild, "restart");
  callbacks.updateSession(session.id, {
    command,
    status: "running",
    finishedAt: null,
    exitCode: null,
    inputHistory: session.inputHistory,
    replyState: emptyReplyState(),
    actionRequest: null
  });
  callbacks.appendSystemLog(session.id, "Prompt interrupt requested.\n");
  callbacks.appendSystemLog(
    session.id,
    "DeskCue restarted the Codex transport after interrupt.\n"
  );
  await callbacks.persistState();

  attachSessionExitHandler({
    child: nextChild,
    getSession: callbacks.getSession,
    isCurrentChild: callbacks.isCurrentChild,
    onAppendSystemLog: callbacks.appendSystemLog,
    onFinishSession: callbacks.finishSession,
    sessionId: session.id
  });

  const updatedSession = callbacks.getSession(session.id);
  if (!updatedSession) throw new AppError("not_found", "Session not found.");

  return updatedSession;
}
