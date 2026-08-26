import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type {
  GitSnapshot,
  ServerEvent,
  SessionDetail,
  SessionLogLine,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";
import { buildGitIdentitySnapshot } from "#infrastructure/git";
import { logger } from "#infrastructure/logging/logger";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import {
  attachSessionDataHandler,
  attachSessionExitHandler
} from "#sessions/process/sessionLifecycle";
import { forwardSessionInput } from "#sessions/process/sessionProcess";
import type { RunningChild, SessionSpawnSpec } from "#sessions/process/sessionProcess";

type SpawnProcessInput = {
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
  sessionId: string;
  spawnSpec?: SessionSpawnSpec;
};

type LaunchSessionCallbacks = {
  appendLog: (
    sessionId: string,
    stream: SessionLogLine["stream"],
    text: string,
    timestamp?: string
  ) => void;
  emitServerEvent: (event: ServerEvent) => void;
  finishSession: (sessionId: string, status: SessionDetail["status"], exitCode: number | null) => void;
  getChild: (sessionId: string) => RunningChild | undefined;
  getPublicSession: (sessionId: string) => SessionDetail | null;
  getSession: (sessionId: string) => SessionDetail | null;
  isCurrentChild: (sessionId: string, child: RunningChild) => boolean;
  markPromptAccepted?: (deliveryId: string) => boolean;
  markPromptDispatching?: (deliveryId: string) => boolean;
  markPromptNotSentAfterSpawnFailure?: (deliveryId: string) => boolean;
  markPromptOutcomeUnknown?: (deliveryId: string) => boolean;
  persistState: () => Promise<void>;
  preparePromptDelivery?: (
    session: SessionDetail,
    prompt: string,
    requestedAt: string
  ) => string;
  scheduleDelayedAction: (
    sessionId: string,
    action: () => Promise<void>,
    delayMs: number
  ) => void;
  sendSourceInput: (
    session: SessionDetail,
    child: RunningChild,
    input: string
  ) => Promise<SessionDetail>;
  setSession: (session: SessionDetail) => void;
  spawnProcess: (input: SpawnProcessInput) => RunningChild;
  startGitPolling: (sessionId: string, workspacePath: string) => void;
  supportsSourceInput: (adapterId: string) => boolean;
  syncWorkspaceFromGit: (workspaceId: string, git: GitSnapshot) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

type LaunchManagedSessionInput = {
  adapterId: string;
  argvInput?: string;
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
  initialInput?: string;
  sourceSessionId: string | null;
  spawnSpec?: SessionSpawnSpec;
  workspace: WorkspaceSummary;
};

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

async function queueInitialInput(
  callbacks: LaunchSessionCallbacks,
  sessionId: string,
  initialInput: string
) {
  const current = callbacks.getSession(sessionId);
  const runningChild = callbacks.getChild(sessionId);

  if (!current || current.status !== "running" || !runningChild) return;

  if (current.sourceSessionId && callbacks.supportsSourceInput(current.adapterId)) {
    try {
      await callbacks.sendSourceInput(current, runningChild, initialInput);
    } catch (error) {
      callbacks.appendLog(
        sessionId,
        "system",
        `Initial input failed: ${error instanceof Error ? error.message : String(error)}\n`
      );

      await callbacks.persistState();
    }

    return;
  }

  try {
    const queuedInput = initialInput.trim();

    forwardSessionInput(current, runningChild, queuedInput);

    callbacks.updateSession(sessionId, {
      inputHistory: [...current.inputHistory, queuedInput]
    });

    callbacks.appendLog(sessionId, "system", "Initial input queued.\n");
    await callbacks.persistState();
  } catch (error) {
    callbacks.appendLog(
      sessionId,
      "system",
      `Initial input failed: ${error instanceof Error ? error.message : String(error)}\n`
    );

    await callbacks.persistState();
  }
}

export async function launchManagedSession(
  callbacks: LaunchSessionCallbacks,
  input: LaunchManagedSessionInput
) {
  const launchStartedAt = performance.now();
  const {
    adapterId,
    argvInput,
    command,
    cwd,
    env,
    initialInput,
    sourceSessionId,
    spawnSpec,
    workspace
  } = input;

  const gitStartedAt = performance.now();
  const git = await buildGitIdentitySnapshot(workspace.path);
  const gitIdentityDurationMs = elapsedMs(gitStartedAt);

  callbacks.syncWorkspaceFromGit(workspace.id, git);
  const argvPrompt = argvInput?.trim();
  const requestedAt = new Date().toISOString();

  const session: SessionDetail = {
    id: randomUUID(),
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    adapterId,
    sourceSessionId,
    command,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastActivityAt: new Date().toISOString(),
    exitCode: null,
    preview: emptyPreview(),
    replyState: argvPrompt
      ? {
          phase: "sending",
          promptText: argvPrompt,
          requestedAt
        }
      : emptyReplyState(),
    actionRequest: null,
    git,
    logs: [],
    inputHistory: argvPrompt ? [argvPrompt] : []
  };

  callbacks.setSession(session);
  const promptDeliveryId = argvPrompt && callbacks.preparePromptDelivery
    ? callbacks.preparePromptDelivery(session, argvPrompt, requestedAt)
    : null;
  logger.info("Session created", {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    workspaceName: session.workspaceName,
    adapterId: session.adapterId,
    sourceSessionId: session.sourceSessionId,
    commandLength: command.length,
    isGitRepo: git.isGitRepo,
    changedFiles: git.changedFiles.length
  });

  callbacks.appendLog(session.id, "system", "Started managed command.\n");
  if (argvPrompt) callbacks.appendLog(session.id, "system", "Initial input sent.\n", requestedAt);
  callbacks.emitServerEvent({
    type: "session.created",
    payload: callbacks.toSummary(session)
  });
  const persistStartedAt = performance.now();

  await callbacks.persistState();
  const persistDurationMs = elapsedMs(persistStartedAt);

  const spawnStartedAt = performance.now();
  let child: RunningChild;
  let processSpawned = false;

  try {
    if (
      promptDeliveryId &&
      callbacks.markPromptDispatching &&
      !callbacks.markPromptDispatching(promptDeliveryId)
    ) {
      throw new Error("Prompt delivery journal was not prepared before process spawn.");
    }

    child = callbacks.spawnProcess({
      command,
      cwd,
      env,
      sessionId: session.id,
      spawnSpec
    });
    processSpawned = true;
    if (
      promptDeliveryId &&
      callbacks.markPromptAccepted &&
      !callbacks.markPromptAccepted(promptDeliveryId)
    ) {
      callbacks.updateSession(session.id, {
        promptRecovery: {
          phase: "outcome_unknown",
          promptText: argvPrompt ?? null,
          requestedAt,
          retryable: false
        }
      });
    }
  } catch (error) {
    if (promptDeliveryId) {
      const definitelyNotSent = !processSpawned &&
        callbacks.markPromptNotSentAfterSpawnFailure?.(promptDeliveryId) === true;
      if (processSpawned) callbacks.markPromptOutcomeUnknown?.(promptDeliveryId);

      callbacks.updateSession(session.id, {
        promptRecovery: {
          phase: definitelyNotSent ? "not_sent" : "outcome_unknown",
          promptText: argvPrompt ?? null,
          requestedAt,
          retryable: definitelyNotSent
        }
      });
    }

    callbacks.appendLog(
      session.id,
      "system",
      `Failed to start command: ${error instanceof Error ? error.message : String(error)}\n`
    );

    callbacks.finishSession(session.id, "failed", null);
    await callbacks.persistState();
    throw error;
  }

  const spawnDurationMs = elapsedMs(spawnStartedAt);

  attachSessionDataHandler({
    adapterId,
    child,
    command,
    onAppendStderrLog: (sessionId, text) => callbacks.appendLog(sessionId, "stderr", text),
    onAppendStdoutLog: (sessionId, text) => callbacks.appendLog(sessionId, "stdout", text),
    onAppendSystemLog: (sessionId, text) => callbacks.appendLog(sessionId, "system", text),
    sessionId: session.id
  });

  logger.info("Session process spawned", {
    sessionId: session.id,
    pid: child.pid ?? null,
    cwd,
    commandLength: command.length,
    gitIdentityDurationMs,
    persistDurationMs,
    spawnDurationMs,
    totalDurationMs: elapsedMs(launchStartedAt)
  });

  callbacks.startGitPolling(session.id, workspace.path);

  if (initialInput?.trim()) {
    callbacks.scheduleDelayedAction(
      session.id,
      () => queueInitialInput(callbacks, session.id, initialInput),
      daemonConfig.initialInputDelayMs
    );
  }

  attachSessionExitHandler({
    child,
    getSession: callbacks.getSession,
    isCurrentChild: callbacks.isCurrentChild,
    onAppendSystemLog: (sessionId, text) => callbacks.appendLog(sessionId, "system", text),
    onFinishSession: (sessionId, status, exitCode) =>
      callbacks.finishSession(sessionId, status, exitCode),
    sessionId: session.id
  });

  return callbacks.getPublicSession(session.id)!;
}
