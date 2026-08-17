import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import type { RunningChild } from "#sessions/process/sessionProcess";

import { interruptCodexSession, sendInputToCodexSession } from "./codexSessionCommands.ts";

function sessionDetail(patch: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "codex resume source-1",
    status: "running",
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-06-22T10:01:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-06-22T10:01:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...patch
  };
}

test("interrupts a running taken-over Codex session by restarting transport", async () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1"
  });
  let restartReason = "";

  const updated = await interruptCodexSession(
    {
      getChild: () => ({
        kill: () => {},
        onData: () => ({ dispose: () => {} }),
        onExit: () => ({ dispose: () => {} }),
        pid: 123,
        process: "codex",
        write: () => {}
      }) as unknown as RunningChild,
      getSession: () => session,
      restartCodexTransport: async (_session, options) => {
        restartReason = options.reason;
        return {
          ...session,
          replyState: emptyReplyState()
        };
      }
    },
    session.id
  );

  assert.equal(restartReason, "interrupt");
  assert.equal(updated.id, session.id);
});

test("rejects an interrupt for a stopped detached Codex session", async () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "stopped"
  });

  await assert.rejects(
    interruptCodexSession(
      {
        getChild: () => undefined,
        getSession: () => session,
        restartCodexTransport: async () => {
          throw new Error("should not restart detached transport");
        }
      },
      session.id
    ),
    /not controlled by DeskCue/
  );
});

test("rejects a normal interrupt for a read-only Codex session owned elsewhere", async () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only"
  });
  await assert.rejects(
    interruptCodexSession(
      {
        getChild: () => undefined,
        getSession: () => session,
        restartCodexTransport: async () => {
          throw new Error("should not restart an externally owned transport");
        }
      },
      session.id
    ),
    /Use Force stop only when DeskCue verifies its process identity/
  );
});

test("starts prompt transport for a detached read-only Codex session", async () => {
  const session = sessionDetail({
    adapterId: "codex",
    sourceSessionId: "source-1",
    status: "read_only"
  });
  let restartReason = "";
  let restartPrompt = "";

  const updated = await sendInputToCodexSession(
    {
      restartCodexTransport: async (_session, options) => {
        restartReason = options.reason;
        restartPrompt = options.prompt ?? "";
        return {
          ...session,
          replyState: {
            phase: "sending",
            promptText: options.prompt ?? null,
            requestedAt: "2026-06-22T10:02:00.000Z"
          },
          status: "running"
        };
      }
    },
    session,
    undefined,
    "continue"
  );

  assert.equal(restartReason, "prompt");
  assert.equal(restartPrompt, "continue");
  assert.equal(updated.status, "running");
});
