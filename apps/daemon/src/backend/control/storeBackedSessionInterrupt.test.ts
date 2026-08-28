import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import { interruptStoreBackedSession } from "./storeBackedSessionInterrupt.ts";

function managedSession(): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "claude-code",
    sourceSessionId: "source-1",
    command: "claude --resume source-1",
    status: "running",
    startedAt: "2026-08-28T10:00:00.000Z",
    finishedAt: null,
    exitCode: null,
    lastActivityAt: "2026-08-28T10:00:00.000Z",
    inputHistory: ["Prompt"],
    logs: [],
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-28T10:00:00.000Z"
    },
    preview: emptyPreview(),
    actionRequest: null,
    replyState: {
      ...emptyReplyState,
      phase: "waiting",
      promptText: "Prompt",
      requestedAt: "2026-08-28T10:00:00.000Z"
    }
  };
}

function sourceSession(): AgentSessionDetail {
  return {
    agentId: "claude-code",
    agentLabel: "Claude Code",
    attachMode: "resume",
    cliVersion: null,
    filePath: "source.jsonl",
    id: "claude-code:source-1",
    model: null,
    originator: null,
    source: "claude.projects",
    sourceSessionId: "source-1",
    title: "Source chat",
    transcript: [],
    updatedAt: "2026-08-28T10:00:00.000Z",
    workspaceName: "Workspace",
    workspacePath: "D:\\work\\repo",
    workState: "running"
  };
}

test("rolls back an exact source request when its first publication throws", async () => {
  const session = managedSession();
  const lifecycle: string[] = [];
  let publishCount = 0;

  await assert.rejects(
    interruptStoreBackedSession({
      cancelQueuedPrompt: async () => session,
      getCodexCallbacks: () => ({}) as never,
      getCommandCallbacks: () => {
        lifecycle.push("transport");
        return {} as never;
      },
      getSession: () => session,
      hasManagedChild: () => true,
      publishSourceSessionUpdate: () => {
        publishCount += 1;
        lifecycle.push(`publish:${publishCount}`);
        if (publishCount === 1) throw new Error("listener failed");
      },
      sourceTurnInterrupts: {
        cancelManagedRequest: () => {
          lifecycle.push("cancel");
          return true;
        },
        decorate: <T>(value: T) => value,
        requestManaged: () => {
          lifecycle.push("request");
          return { ownsCancellation: true, record: {} };
        }
      } as never
    }, "session-1", {
      fingerprint: "turn-1",
      startedAt: "2026-08-28T10:00:00.000Z",
      userEntryId: "user-1"
    }, sourceSession()),
    /listener failed/
  );

  assert.deepEqual(lifecycle, ["request", "publish:1", "cancel", "publish:2"]);
});
