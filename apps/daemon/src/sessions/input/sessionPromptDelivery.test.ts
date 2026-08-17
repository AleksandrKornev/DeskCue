import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import type { RunningChild } from "#sessions/process/sessionProcess";

import { sendSessionInput } from "./sessionPromptDelivery.ts";

function session(): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "generic-cli",
    sourceSessionId: null,
    command: "cat",
    status: "running",
    startedAt: "2026-06-22T10:00:00.000Z",
    finishedAt: null,
    lastActivityAt: "2026-06-22T10:00:00.000Z",
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
      lastUpdatedAt: "2026-06-22T10:00:00.000Z"
    },
    logs: [],
    inputHistory: []
  };
}

test("forwards generic input through callback boundary", async () => {
  let current = session();
  let written = "";
  let persisted = false;
  const child = {
    write(value: string) {
      written += value;
    }
  } as RunningChild;

  const result = await sendSessionInput(
    {
      appendSystemLog: () => {},
      getChild: () => child,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      persistState: async () => {
        persisted = true;
      },
      resumeAgentSession: async () => {
        throw new Error("Unexpected agent resume.");
      },
      sendSourceInput: async () => {
        throw new Error("Unexpected source input.");
      },
      supportsSourceInput: () => false,
      updateSession: (_sessionId, patch) => {
        current = {
          ...current,
          ...patch
        };
      }
    },
    "session-1",
    "hello"
  );

  assert.match(written, /hello/);
  assert.equal(persisted, true);
  assert.deepEqual(result.inputHistory, ["hello"]);
});

test("submits manual Codex command input with Codex TUI sequence", async () => {
  let current = session();
  current.command = "codex --no-alt-screen -a on-request -s read-only";
  let written = "";
  const child = {
    write(value: string) {
      written += value;
    }
  } as RunningChild;

  await sendSessionInput(
    {
      appendSystemLog: () => {},
      getChild: () => child,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      persistState: async () => {},
      resumeAgentSession: async () => {
        throw new Error("Unexpected agent resume.");
      },
      sendSourceInput: async () => {
        throw new Error("Unexpected source input.");
      },
      supportsSourceInput: () => false,
      updateSession: (_sessionId, patch) => {
        current = {
          ...current,
          ...patch
        };
      }
    },
    "session-1",
    "create a file"
  );

  assert.equal(written, process.platform === "win32" ? "create a file\r" : "create a file\n");
});

test("normalizes multiline manual Codex command input before TUI submit", async () => {
  let current = session();
  current.command = "codex";
  let written = "";
  const child = {
    write(value: string) {
      written += value;
    }
  } as RunningChild;

  await sendSessionInput(
    {
      appendSystemLog: () => {},
      getChild: () => child,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      persistState: async () => {},
      resumeAgentSession: async () => {
        throw new Error("Unexpected agent resume.");
      },
      sendSourceInput: async () => {
        throw new Error("Unexpected source input.");
      },
      supportsSourceInput: () => false,
      updateSession: (_sessionId, patch) => {
        current = {
          ...current,
          ...patch
        };
      }
    },
    "session-1",
    "line one\nline two"
  );

  assert.equal(written, process.platform === "win32" ? "line one line two\r" : "line one line two\n");
});

test("forwards Codex approval decisions to the running PTY without restarting transport", async () => {
  let current = session();
  current.adapterId = "codex";
  current.sourceSessionId = "codex-source";
  current.command = "codex resume codex-source";
  current.actionRequest = {
    command: "Set-Content -LiteralPath .\\approval.txt -Value ok -NoNewline",
    kind: "approval",
    reason: "Allow writing approval.txt?",
    requestedAt: "2026-06-22T10:02:00.000Z"
  };
  let written = "";
  let sendSourceInputCalled = false;
  const child = {
    write(value: string) {
      written += value;
    }
  } as RunningChild;

  const result = await sendSessionInput(
    {
      appendSystemLog: () => {},
      getChild: () => child,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      persistState: async () => {},
      resumeAgentSession: async () => {
        throw new Error("Unexpected agent resume.");
      },
      sendSourceInput: async () => {
        sendSourceInputCalled = true;
        throw new Error("Unexpected source input.");
      },
      supportsSourceInput: () => true,
      updateSession: (_sessionId, patch) => {
        current = {
          ...current,
          ...patch
        };
      }
    },
    "session-1",
    "y"
  );

  assert.equal(written, process.platform === "win32" ? "y\r\n" : "y\n");
  assert.equal(sendSourceInputCalled, false);
  assert.equal(result.actionRequest, null);
  assert.deepEqual(result.inputHistory, ["approve"]);
});

test("resumes detached Codex shell for stopped input", async () => {
  const current = session();
  current.adapterId = "codex";
  current.sourceSessionId = "codex-source";
  current.status = "stopped";
  let sentInput = "";
  let sentChild: RunningChild | undefined = {} as RunningChild;

  await sendSessionInput(
    {
      appendSystemLog: () => {},
      getChild: () => undefined,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      persistState: async () => {},
      resumeAgentSession: async (agentSession, prompt) => {
        throw new Error(`Unexpected agent resume: ${agentSession.id} ${prompt ?? ""}`);
      },
      sendSourceInput: async (_session, child, input) => {
        sentChild = child;
        sentInput = input;
        return current;
      },
      supportsSourceInput: () => true,
      updateSession: () => {}
    },
    "session-1",
    "continue"
  );

  assert.equal(sentInput, "continue");
  assert.equal(sentChild, undefined);
});

test("resumes read-only Codex shell for takeover input", async () => {
  const current = session();
  current.adapterId = "codex";
  current.sourceSessionId = "codex-source";
  current.status = "read_only";
  let sentInput = "";
  let sentChild: RunningChild | undefined = {} as RunningChild;

  await sendSessionInput(
    {
      appendSystemLog: () => {},
      getChild: () => undefined,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => null,
      persistState: async () => {},
      resumeAgentSession: async (agentSession, prompt) => {
        throw new Error(`Unexpected agent resume: ${agentSession.id} ${prompt ?? ""}`);
      },
      sendSourceInput: async (_session, child, input) => {
        sentChild = child;
        sentInput = input;
        return current;
      },
      supportsSourceInput: () => true,
      updateSession: () => {}
    },
    "session-1",
    "continue"
  );

  assert.equal(sentInput, "continue");
  assert.equal(sentChild, undefined);
});

test("routes detached Claude Code input to the one-shot transport instead of PTY forwarding", async () => {
  const current = session();
  current.adapterId = "claude-code";
  current.sourceSessionId = "claude-source";
  current.status = "stopped";
  const workspace: WorkspaceSummary = {
    id: "workspace-1",
    name: "Workspace",
    path: "C:/workspace",
    isGitRepo: false,
    branch: null,
    createdAt: "2026-06-22T10:00:00.000Z"
  };
  let sentPrompt = "";

  await sendSessionInput(
    {
      appendSystemLog: () => {},
      getChild: () => undefined,
      getPublicSession: () => current,
      getSession: () => current,
      getWorkspace: () => workspace,
      persistState: async () => {},
      resumeAgentSession: async () => {
        throw new Error("Unexpected generic Claude resume.");
      },
      sendSourceInput: async (_session, _child, prompt) => {
        sentPrompt = prompt;
        return current;
      },
      supportsSourceInput: () => true,
      updateSession: () => {}
    },
    "session-1",
    "continue claude"
  );

  assert.equal(sentPrompt, "continue claude");
});

test("rejects detached LM Studio input because it is review-only", async () => {
  const current = session();
  current.adapterId = "lm-studio";
  current.sourceSessionId = "lm-source";
  current.status = "stopped";

  await assert.rejects(
    () =>
      sendSessionInput(
        {
          appendSystemLog: () => {},
          getChild: () => undefined,
          getPublicSession: () => current,
          getSession: () => current,
          getWorkspace: () => {
            throw new Error("Unexpected workspace lookup.");
          },
          persistState: async () => {},
          resumeAgentSession: async () => {
            throw new Error("Unexpected LM Studio resume.");
          },
          sendSourceInput: async () => {
            throw new Error("Unexpected source input.");
          },
          supportsSourceInput: () => false,
          updateSession: () => {}
        },
        "session-1",
        "continue"
      ),
    /Session is not accepting input/
  );
});
