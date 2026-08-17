import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import type { RunningChild } from "#sessions/process/sessionProcess";

import {
  buildClaudeResumePrintTransport,
  restartClaudePromptTransport
} from "./claudePromptDelivery.ts";

function claudeSession(): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "claude-code",
    sourceSessionId: "claude-source",
    command: "claude --resume claude-source --print previous",
    status: "read_only",
    startedAt: "2026-07-31T10:00:00.000Z",
    finishedAt: "2026-07-31T10:01:00.000Z",
    lastActivityAt: "2026-07-31T10:01:00.000Z",
    exitCode: 0,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    actionRequest: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-07-31T10:01:00.000Z"
    },
    logs: [],
    inputHistory: []
  };
}

test("builds a Claude one-shot resume with direct argv, preserving arbitrary prompt text", () => {
  const prompt = 'Reply with "quoted" text; do not run anything.';
  const transport = buildClaudeResumePrintTransport("source-session", prompt);

  assert.deepEqual(transport.spawnSpec.args, ["--resume", "source-session", "--print", prompt]);
  assert.equal(transport.spawnSpec.closeStdin, true);
  assert.equal(transport.spawnSpec.transport, "pipe");
  assert.ok(transport.spawnSpec.file);
  assert.match(transport.command, /--resume/);
  assert.match(transport.command, /--print/);
});

test("restarts an attached Claude shell through a one-shot pipe transport", async () => {
  let current = claudeSession();
  const workspace: WorkspaceSummary = {
    branch: null,
    createdAt: "2026-07-31T10:00:00.000Z",
    id: current.workspaceId,
    isGitRepo: false,
    name: current.workspaceName,
    path: "C:/workspace"
  };
  const systemLogs: string[] = [];
  const deliveryLifecycle: string[] = [];
  let spawned: Parameters<RunningChild["onData"]>[0] | null = null;
  const child = {
    pid: 42,
    transport: "pipe" as const,
    kill() {},
    onData(handler: Parameters<RunningChild["onData"]>[0]) {
      spawned = handler;
      return { dispose() {} };
    },
    onExit() {
      return { dispose() {} };
    },
    write() {}
  } satisfies RunningChild;
  const captured = {
    spawnInput: null as { command: string; spawnSpec?: { args: string[] } } | null
  };

  const result = await restartClaudePromptTransport(
    {
      appendStdoutLog: () => {},
      appendSystemLog: (_sessionId, text) => systemLogs.push(text),
      findBackgroundAgent: async () => null,
      resolveBackgroundControlCapability: async (sourceSessionId) => ({
        kind: "observe_only",
        sourceSessionId,
        reason: "session_not_listed"
      }),
      finishSession: () => {},
      getChild: () => undefined,
      getSession: () => current,
      getWorkspace: () => workspace,
      isCurrentChild: () => true,
      markPromptAccepted: () => deliveryLifecycle.push("accepted"),
      markPromptDispatching: () => deliveryLifecycle.push("dispatching"),
      persistState: async () => {},
      spawnProcess: (input) => {
        deliveryLifecycle.push("spawn");
        captured.spawnInput = input;
        return child;
      },
      startGitPolling: () => {},
      stopGitPolling: () => {},
      updateSession: (_sessionId, patch) => {
        current = { ...current, ...patch };
      }
    },
    current,
    "continue from DeskCue"
  );

  assert.equal(result.status, "running");
  assert.equal(result.replyState.phase, "sending");
  assert.deepEqual(result.inputHistory, ["continue from DeskCue"]);
  assert.deepEqual(captured.spawnInput?.spawnSpec?.args, [
    "--resume",
    "claude-source",
    "--print",
    "continue from DeskCue"
  ]);
  assert.ok(spawned);
  assert.deepEqual(systemLogs, [
    "Input sent.\n",
    "DeskCue started a one-shot Claude Code resume for this prompt.\n"
  ]);
  assert.deepEqual(deliveryLifecycle, ["dispatching", "spawn", "accepted"]);
});

test("refuses to start a competing Claude prompt for an active external interactive chat", async () => {
  const current = claudeSession();
  const workspace: WorkspaceSummary = {
    branch: null,
    createdAt: "2026-07-31T10:00:00.000Z",
    id: current.workspaceId,
    isGitRepo: false,
    name: current.workspaceName,
    path: "C:/workspace"
  };

  await assert.rejects(
    restartClaudePromptTransport(
      {
        appendStdoutLog: () => {},
        appendSystemLog: () => {},
        findBackgroundAgent: async () => null,
        resolveBackgroundControlCapability: async (sourceSessionId) => ({
          kind: "observe_only",
          sourceSessionId,
          reason: "interactive_session"
        }),
        finishSession: () => {},
        getChild: () => undefined,
        getSession: () => current,
        getWorkspace: () => workspace,
        isCurrentChild: () => true,
        persistState: async () => {},
        spawnProcess: () => {
          throw new Error("must not spawn");
        },
        startGitPolling: () => {},
        stopGitPolling: () => {},
        updateSession: () => {}
      },
      current,
      "continue from DeskCue"
    ),
    /active outside DeskCue/
  );
});

test("does not spawn Claude when durable dispatch transition fails", async () => {
  const current = claudeSession();
  const workspace: WorkspaceSummary = {
    branch: null,
    createdAt: "2026-07-31T10:00:00.000Z",
    id: current.workspaceId,
    isGitRepo: false,
    name: current.workspaceName,
    path: "C:/workspace"
  };
  let spawnCount = 0;

  await assert.rejects(
    restartClaudePromptTransport(
      {
        appendStdoutLog: () => {},
        appendSystemLog: () => {},
        findBackgroundAgent: async () => null,
        resolveBackgroundControlCapability: async (sourceSessionId) => ({
          kind: "observe_only",
          sourceSessionId,
          reason: "session_not_listed"
        }),
        finishSession: () => {},
        getChild: () => undefined,
        getSession: () => current,
        getWorkspace: () => workspace,
        isCurrentChild: () => true,
        markPromptDispatching: () => {
          throw new Error("journal transition failed");
        },
        persistState: async () => {},
        spawnProcess: () => {
          spawnCount += 1;
          throw new Error("must not spawn");
        },
        startGitPolling: () => {},
        stopGitPolling: () => {},
        updateSession: () => {}
      },
      current,
      "continue from DeskCue"
    ),
    /journal transition failed/
  );

  assert.equal(spawnCount, 0);
});
