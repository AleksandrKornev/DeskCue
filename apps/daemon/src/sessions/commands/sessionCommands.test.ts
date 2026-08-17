import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import type { RunningChild } from "#sessions/process/sessionProcess";

import { interruptManagedPtySession, setManagedSessionPreviewPort } from "./sessionCommands.ts";

function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "npm run test",
    status: "running",
    startedAt: "2026-07-30T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-07-30T10:00:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    actionRequest: null,
    git: {
      branch: null,
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: false,
      lastUpdatedAt: "2026-07-30T10:00:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...overrides
  };
}

test("preserves preview network routing when legacy port updates omit it", async () => {
  let current = sessionDetail({
    preview: {
      ...emptyPreview(),
      networkMode: "deskcue-host"
    }
  });
  const callbacks = {
    appendSystemLog: () => {},
    emitServerEvent: () => {},
    getChild: () => undefined,
    getPublicSession: () => current,
    getSession: () => current,
    getWorkspace: () => null,
    killChild: async () => {},
    persistState: async () => {},
    syncWorkspaceFromGit: () => {},
    toSummary: (value: SessionDetail) => value,
    updateSession: (_sessionId: string, patch: Partial<SessionDetail>) => {
      current = { ...current, ...patch };
    }
  };

  await setManagedSessionPreviewPort(callbacks, current.id, 5173);
  assert.equal(current.preview.networkMode, "deskcue-host");
  assert.equal(current.preview.port, 5173);

  await setManagedSessionPreviewPort(callbacks, current.id, null);
  assert.equal(current.preview.networkMode, "deskcue-host");
  assert.equal(current.preview.active, false);
});

test("requests a managed Codex PTY interrupt without stopping the session", async () => {
  const current = sessionDetail({
    adapterId: "codex",
    command: "codex",
    sourceSessionId: "source-1"
  });
  const systemLogs: string[] = [];
  let persisted = false;
  let written = "";
  const child = {
    pid: 42,
    write(value: string) {
      written = value;
    }
  } as RunningChild;

  const result = await interruptManagedPtySession(
    {
      appendSystemLog: (_sessionId, text) => systemLogs.push(text),
      emitServerEvent: () => {},
      getChild: () => child,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      killChild: () => {
        throw new Error("Interrupt must not kill the managed terminal.");
      },
      persistState: async () => {
        persisted = true;
      },
      syncWorkspaceFromGit: () => {},
      toSummary: (session) => session,
      updateSession: () => {}
    },
    current.id
  );

  assert.equal(result?.id, current.id);
  assert.equal(current.status, "running");
  assert.equal(written, "\x1b");
  assert.deepEqual(systemLogs, [
    "Prompt interrupt requested.\n",
    "DeskCue sent Escape to the managed terminal and is waiting for the agent state to update.\n"
  ]);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(persisted, true);
});

test("does not fabricate an interrupt for a generic managed terminal", async () => {
  let current = sessionDetail();
  let written = "";
  const systemLogs: string[] = [];
  let persisted = false;
  const child = {
    pid: 42,
    write(value: string) {
      written = value;
    }
  } as RunningChild;

  const result = await interruptManagedPtySession(
    {
      appendSystemLog: (_sessionId, text) => systemLogs.push(text),
      emitServerEvent: () => {},
      getChild: () => child,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      killChild: () => {
        throw new Error("Interrupt must not kill the managed terminal.");
      },
      persistState: async () => {
        persisted = true;
      },
      syncWorkspaceFromGit: () => {},
      toSummary: (session) => session,
      updateSession: (_sessionId, patch) => {
        current = {
          ...current,
          ...patch
        };
      }
    },
    current.id
  );

  assert.equal(result, null);
  assert.equal(current.status, "running");
  assert.equal(written, "");
  assert.deepEqual(systemLogs, []);

  return new Promise<void>((resolve) => {
    setImmediate(() => {
      assert.equal(persisted, false);
      resolve();
    });
  });
});

test("terminates a DeskCue-owned Claude one-shot pipe without writing Escape", async () => {
  let current = sessionDetail({
    adapterId: "claude-code",
    command: "claude --resume claude-source --print continue",
    sourceSessionId: "claude-source"
  });
  let written = "";
  let killReason: string | null = null;
  const systemLogs: string[] = [];
  let persisted = false;
  const child = {
    pid: 42,
    transport: "pipe" as const,
    write(value: string) {
      written += value;
    }
  } as RunningChild;

  const result = await interruptManagedPtySession(
    {
      appendSystemLog: (_sessionId, text) => systemLogs.push(text),
      emitServerEvent: () => {},
      getChild: () => child,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      killChild: async (_sessionId, killedChild, reason) => {
        assert.equal(killedChild, child);
        killReason = reason;
      },
      persistState: async () => {
        persisted = true;
      },
      syncWorkspaceFromGit: () => {},
      toSummary: (session) => session,
      updateSession: (_sessionId, patch) => {
        current = { ...current, ...patch };
      }
    },
    current.id
  );

  assert.equal(result?.status, "stopped");
  assert.equal(current.replyState.phase, "idle");
  assert.equal(written, "");
  assert.equal(killReason, "prompt_interrupt");
  assert.deepEqual(systemLogs, [
    "Prompt interrupt requested.\n",
    "DeskCue is stopping the one-shot Claude Code process. You can send the next prompt when it exits.\n"
  ]);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(persisted, true);
});

test("terminates a DeskCue-owned Codex one-shot pipe instead of writing Escape", async () => {
  let current = sessionDetail({
    adapterId: "codex",
    command: "codex exec resume source-1 continue",
    sourceSessionId: "source-1"
  });
  let written = "";
  let killReason: string | null = null;
  const systemLogs: string[] = [];
  const child = {
    pid: 42,
    transport: "pipe" as const,
    write(value: string) {
      written += value;
    }
  } as RunningChild;

  const result = await interruptManagedPtySession(
    {
      appendSystemLog: (_sessionId, text) => systemLogs.push(text),
      emitServerEvent: () => {},
      getChild: () => child,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      killChild: async (_sessionId, killedChild, reason) => {
        assert.equal(killedChild, child);
        killReason = reason;
      },
      persistState: async () => {},
      syncWorkspaceFromGit: () => {},
      toSummary: (session) => session,
      updateSession: (_sessionId, patch) => {
        current = { ...current, ...patch };
      }
    },
    current.id
  );

  assert.equal(result?.status, "stopped");
  assert.equal(current.replyState.phase, "idle");
  assert.equal(written, "");
  assert.equal(killReason, "prompt_interrupt");
  assert.deepEqual(systemLogs, [
    "Prompt interrupt requested.\n",
    "DeskCue is stopping the one-shot Codex process. You can send the next prompt when it exits.\n"
  ]);
});

test("keeps a one-shot session running when process termination is unconfirmed", async () => {
  let current = sessionDetail({
    adapterId: "codex",
    command: "codex exec resume source-1 continue",
    sourceSessionId: "source-1"
  });
  const originalReplyState = current.replyState;
  const systemLogs: string[] = [];
  let persisted = false;
  const child = {
    pid: 42,
    transport: "pipe" as const,
    write() {}
  } as unknown as RunningChild;

  await assert.rejects(
    interruptManagedPtySession(
      {
        appendSystemLog: (_sessionId, text) => systemLogs.push(text),
        emitServerEvent: () => {},
        getChild: () => child,
        getPublicSession: () => current,
        getSession: () => current,
        getWorkspace: () => null,
        killChild: async () => {
          throw new Error("process tree did not exit");
        },
        persistState: async () => {
          persisted = true;
        },
        syncWorkspaceFromGit: () => {},
        toSummary: (session) => session,
        updateSession: (_sessionId, patch) => {
          current = { ...current, ...patch };
        }
      },
      current.id
    ),
    /process tree did not exit/
  );

  assert.equal(current.status, "running");
  assert.deepEqual(current.replyState, originalReplyState);
  assert.equal(persisted, true);
  assert.equal(
    systemLogs.at(-1),
    "DeskCue could not confirm the prompt process stopped; it remains attached.\n"
  );
});

test("does not fabricate a managed terminal interrupt after the child is gone", async () => {
  const current = sessionDetail();
  const result = await interruptManagedPtySession(
    {
      appendSystemLog: () => {},
      emitServerEvent: () => {},
      getChild: () => undefined,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      killChild: async () => {},
      persistState: async () => {},
      syncWorkspaceFromGit: () => {},
      toSummary: (session) => session,
      updateSession: () => {}
    },
    current.id
  );

  assert.equal(result, null);
});

test("does not send Escape to an observed source session without an owned PTY", async () => {
  const current = sessionDetail({
    adapterId: "codex",
    command: "codex resume source-1",
    sourceSessionId: "source-1"
  });
  let persisted = false;
  const systemLogs: string[] = [];

  const result = await interruptManagedPtySession(
    {
      appendSystemLog: (_sessionId, text) => systemLogs.push(text),
      emitServerEvent: () => {},
      getChild: () => undefined,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      killChild: () => {
        throw new Error("Observed source sessions must not be terminated.");
      },
      persistState: async () => {
        persisted = true;
      },
      syncWorkspaceFromGit: () => {},
      toSummary: (session) => session,
      updateSession: () => {}
    },
    current.id
  );

  assert.equal(result, null);
  assert.deepEqual(systemLogs, []);

  return new Promise<void>((resolve) => {
    setImmediate(() => {
      assert.equal(persisted, false);
      resolve();
    });
  });
});
