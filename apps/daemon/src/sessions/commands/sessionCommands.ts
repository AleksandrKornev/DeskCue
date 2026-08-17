import { randomUUID } from "node:crypto";

import type {
  CapturePreviewArtifactPayload,
  GitSnapshot,
  PreviewArtifact,
  PreviewConfig,
  PreviewNetworkMode,
  ServerEvent,
  SessionDetail,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { buildGitSnapshot } from "#infrastructure/git";
import { logger } from "#infrastructure/logging/logger";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import { requestSessionPtyInterrupt } from "#sessions/process/sessionProcess";
import type { RunningChild } from "#sessions/process/sessionProcess";

type SessionCommandCallbacks = {
  appendSystemLog: (sessionId: string, text: string) => void;
  emitServerEvent: (event: ServerEvent) => void;
  getChild: (sessionId: string) => RunningChild | undefined;
  getPublicSession: (sessionId: string) => SessionDetail | null;
  getSession: (sessionId: string) => SessionDetail | null;
  getWorkspace: (workspaceId: string) => WorkspaceSummary | null;
  killChild: (sessionId: string, child: RunningChild | undefined, reason: string) => void;
  persistState: () => Promise<void>;
  syncWorkspaceFromGit: (workspaceId: string, git: GitSnapshot) => void;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

type RefreshManagedSessionGitOptions = {
  includeDiff?: boolean;
};

function requireSession(callbacks: SessionCommandCallbacks, sessionId: string) {
  const session = callbacks.getSession(sessionId);
  if (!session) {
    throw new AppError("not_found", "Session not found.");
  }

  return session;
}

function requirePublicSession(callbacks: SessionCommandCallbacks, sessionId: string) {
  const session = callbacks.getPublicSession(sessionId);
  if (!session) {
    throw new AppError("not_found", "Session not found.");
  }

  return session;
}

export async function refreshManagedSessionGit(
  callbacks: SessionCommandCallbacks,
  sessionId: string,
  options: RefreshManagedSessionGitOptions = {}
) {
  const session = callbacks.getSession(sessionId);
  if (!session) {
    throw new AppError("not_found", "Session not found.");
  }

  const workspace = callbacks.getWorkspace(session.workspaceId);
  if (!workspace) {
    throw new AppError("not_found", "Workspace not found.");
  }

  const git = await buildGitSnapshot(workspace.path, {
    includeDiff: options.includeDiff
  });
  callbacks.updateSession(sessionId, {
    git
  });
  callbacks.syncWorkspaceFromGit(workspace.id, git);

  const updatedSession = requireSession(callbacks, sessionId);
  callbacks.emitServerEvent({
    type: "session.git",
    payload: callbacks.toSummary(updatedSession)
  });
  logger.info("Session git snapshot refreshed", {
    sessionId,
    workspaceId: workspace.id,
    isDirty: git.isDirty,
    changedFiles: git.changedFiles.length
  });
  await callbacks.persistState();

  return requirePublicSession(callbacks, sessionId);
}

export async function setManagedSessionPreviewPort(
  callbacks: SessionCommandCallbacks,
  sessionId: string,
  port: number | null,
  networkMode?: PreviewNetworkMode
) {
  const session = callbacks.getSession(sessionId);
  if (!session) {
    throw new AppError("not_found", "Session not found.");
  }

  const resolvedNetworkMode = networkMode ?? session.preview.networkMode;
  const preview: PreviewConfig =
    port === null
      ? { ...emptyPreview(), networkMode: resolvedNetworkMode }
      : {
          port,
          active: true,
          targetUrl: `http://127.0.0.1:${port}`,
          networkMode: resolvedNetworkMode,
          artifacts: session.preview?.artifacts ?? []
        };

  callbacks.updateSession(sessionId, {
    preview
  });
  const updatedSession = requireSession(callbacks, sessionId);
  callbacks.emitServerEvent({
    type: "session.preview",
    payload: callbacks.toSummary(updatedSession)
  });
  logger.info("Session preview updated", {
    sessionId,
    port: preview.port,
    active: preview.active,
    networkMode: preview.networkMode
  });
  await callbacks.persistState();

  return requirePublicSession(callbacks, sessionId);
}

function buildPreviewArtifact(
  session: SessionDetail,
  payload: CapturePreviewArtifactPayload
): PreviewArtifact {
  const capturedAt = new Date().toISOString();
  const changedFiles = session.git.changedFiles.length;
  const logLines = session.logs.length;

  return {
    id: `preview-${randomUUID()}`,
    capturedAt,
    targetUrl: session.preview.targetUrl ?? "",
    viewport: payload.viewport,
    source: "metadata",
    title: `${payload.viewport === "mobile" ? "Mobile" : "Desktop"} preview`,
    notes: [
      `Target: ${session.preview.targetUrl}`,
      `Session status: ${session.status}`,
      `Changed files: ${changedFiles}`,
      `Log lines: ${logLines}`
    ]
  };
}

export async function captureManagedSessionPreviewArtifact(
  callbacks: SessionCommandCallbacks,
  sessionId: string,
  payload: CapturePreviewArtifactPayload
) {
  const session = callbacks.getSession(sessionId);
  if (!session) {
    throw new AppError("not_found", "Session not found.");
  }

  if (!session.preview.active || !session.preview.targetUrl) {
    throw new AppError("invalid_input", "Preview is not active for this session.");
  }

  const artifact = buildPreviewArtifact(session, payload);
  const preview: PreviewConfig = {
    ...session.preview,
    artifacts: [artifact, ...(session.preview.artifacts ?? [])].slice(0, 20)
  };

  callbacks.updateSession(sessionId, {
    preview
  });
  const updatedSession = requireSession(callbacks, sessionId);
  callbacks.emitServerEvent({
    type: "session.preview",
    payload: callbacks.toSummary(updatedSession)
  });
  logger.info("Session preview artifact captured", {
    artifactId: artifact.id,
    sessionId,
    targetUrl: artifact.targetUrl,
    viewport: artifact.viewport
  });
  await callbacks.persistState();

  return requirePublicSession(callbacks, sessionId);
}

export async function stopRunningSession(
  callbacks: SessionCommandCallbacks,
  sessionId: string
) {
  const session = callbacks.getSession(sessionId);
  const child = callbacks.getChild(sessionId);
  if (!session) {
    throw new AppError("not_found", "Session not found.");
  }

  if (!child) {
    if (session.status === "running") {
      callbacks.updateSession(sessionId, {
        status: "stopped",
        finishedAt: session.finishedAt ?? new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        replyState: emptyReplyState(),
        actionRequest: null
      });
      callbacks.appendSystemLog(sessionId, "Stop requested, but DeskCue is no longer attached to a running process.\n");
      await callbacks.persistState();
    }

    const updatedSession = callbacks.getPublicSession(sessionId);
    if (!updatedSession) {
      throw new AppError("not_found", "Session not found.");
    }

    return updatedSession;
  }

  callbacks.appendSystemLog(sessionId, "Stop requested.\n");
  callbacks.updateSession(sessionId, {
    status: "stopped",
    replyState: emptyReplyState(),
    actionRequest: null
  });
  logger.warn("Stopping session process", {
    sessionId,
    pid: child.pid ?? null
  });
  try {
    await callbacks.killChild(sessionId, child, "stop");
  } catch (error) {
    callbacks.updateSession(sessionId, {
      status: session.status,
      replyState: session.replyState,
      actionRequest: session.actionRequest
    });
    callbacks.appendSystemLog(
      sessionId,
      "DeskCue could not confirm that the process stopped; it remains attached and will retry during shutdown.\n"
    );
    await callbacks.persistState();
    throw error;
  }
  await callbacks.persistState();

  return requirePublicSession(callbacks, sessionId);
}

export async function interruptManagedPtySession(
  callbacks: SessionCommandCallbacks,
  sessionId: string
) {
  const session = callbacks.getSession(sessionId);
  if (!session) {
    throw new AppError("not_found", "Session not found.");
  }

  const child = callbacks.getChild(sessionId);
  if (!child) {
    return null;
  }

  if (session.status !== "running") {
    throw new AppError("not_accepting_input", "Session is not running.");
  }

  if (child.transport === "pipe") {
    const agentLabel = session.adapterId === "codex"
      ? "Codex"
      : session.adapterId === "claude-code"
        ? "Claude Code"
        : "agent";
    callbacks.appendSystemLog(sessionId, "Prompt interrupt requested.\n");
    callbacks.appendSystemLog(
      sessionId,
      `DeskCue is stopping the one-shot ${agentLabel} process. You can send the next prompt when it exits.\n`
    );
    callbacks.updateSession(sessionId, {
      status: "stopped",
      replyState: emptyReplyState(),
      actionRequest: null
    });
    logger.info("One-shot prompt interrupt requested", {
      adapterId: session.adapterId,
      pid: child.pid ?? null,
      sessionId
    });
    try {
      await callbacks.killChild(sessionId, child, "prompt_interrupt");
    } catch (error) {
      callbacks.updateSession(sessionId, {
        status: session.status,
        replyState: session.replyState,
        actionRequest: session.actionRequest
      });
      callbacks.appendSystemLog(
        sessionId,
        "DeskCue could not confirm the prompt process stopped; it remains attached.\n"
      );
      await callbacks.persistState();
      throw error;
    }
    await callbacks.persistState();

    return requirePublicSession(callbacks, sessionId);
  }

  const interruptKey = requestSessionPtyInterrupt(session, child);
  if (!interruptKey) {
    return null;
  }

  callbacks.appendSystemLog(sessionId, "Prompt interrupt requested.\n");
  callbacks.appendSystemLog(
    sessionId,
    `DeskCue sent ${interruptKey} to the managed terminal and is waiting for the agent state to update.\n`
  );
  logger.info("Managed PTY prompt interrupt requested", {
    adapterId: session.adapterId,
    interruptKey,
    pid: child.pid ?? null,
    sessionId
  });
  await callbacks.persistState();

  return requirePublicSession(callbacks, sessionId);
}
