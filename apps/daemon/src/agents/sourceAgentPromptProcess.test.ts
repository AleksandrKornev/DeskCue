import assert from "node:assert/strict";
import test from "node:test";

import {
  runSourcePromptProcessLifecycle,
  SourcePromptStartupError
} from "./sourceAgentPromptProcess.ts";

function lifecycle(overrides: Record<string, unknown> = {}) {
  return {
    beforeProcessStart: async () => {},
    command: "codex",
    env: {},
    logStarted: () => {},
    prompt: "Continue",
    requestedAt: "2026-08-21T00:00:00.000Z",
    session: { id: "session-1" },
    spawnSpec: {},
    startedMessage: "Started.\n",
    workspace: { path: "workspace" },
    ...overrides
  } as never;
}

test("does not dispatch when pre-start work fails", async () => {
  const events: string[] = [];
  const stopError = new Error("could not stop old child");
  const callbacks = {
    spawnProcess: () => {
      events.push("spawn");
      return {};
    },
    markPromptDispatching: () => events.push("dispatching"),
    markPromptAccepted: () => events.push("accepted")
  } as never;

  await assert.rejects(
    runSourcePromptProcessLifecycle(callbacks, lifecycle({
      beforeProcessStart: async () => {
        events.push("pre-start");
        throw stopError;
      }
    })),
    stopError
  );

  assert.deepEqual(events, ["pre-start"]);
});

test("writes dispatching before a synchronous spawn attempt", async () => {
  const events: string[] = [];
  const spawnError = new Error("spawn failed");
  const callbacks = {
    spawnProcess: () => {
      events.push("spawn");
      throw spawnError;
    },
    markPromptDispatching: () => events.push("dispatching"),
    markPromptAccepted: () => events.push("accepted")
  } as never;

  await assert.rejects(
    runSourcePromptProcessLifecycle(callbacks, lifecycle({
      beforeProcessStart: async () => {
        events.push("pre-start");
      },
    })),
    (error: unknown) => {
      assert.ok(error instanceof SourcePromptStartupError);
      assert.equal(error.cause, spawnError);
      assert.equal(error.child, undefined);
      return true;
    }
  );

  assert.deepEqual(events, ["pre-start", "dispatching", "spawn"]);
});

test("awaits child readiness before accepting the delivery", async () => {
  const events: string[] = [];
  const acceptedError = new Error("stop after accepted");
  let resolveReady!: () => void;

  const startupReady = new Promise<void>((resolve) => {
    resolveReady = () => {
      events.push("ready");
      resolve();
    };
  });
  const callbacks = {
    spawnProcess: () => {
      events.push("spawn");
      return { startupReady };
    },
    markPromptDispatching: () => events.push("dispatching"),
    markPromptAccepted: () => {
      events.push("accepted");
      throw acceptedError;
    }
  } as never;

  const result = runSourcePromptProcessLifecycle(callbacks, lifecycle({
    beforeProcessStart: async () => {
      events.push("pre-start");
    }
  }));

  await Promise.resolve();
  assert.deepEqual(events, ["pre-start", "dispatching", "spawn"]);
  resolveReady();
  await assert.rejects(result, acceptedError);
  assert.deepEqual(events, ["pre-start", "dispatching", "spawn", "ready", "accepted"]);
});

test("reports a rejected readiness handshake as a confirmed startup failure", async () => {
  const startupError = new Error("nested process failed");
  const child = { startupReady: Promise.reject(startupError) };
  const callbacks = {
    spawnProcess: () => child,
    markPromptDispatching: () => {},
    markPromptAccepted: () => assert.fail("delivery must not be accepted")
  } as never;

  await assert.rejects(
    runSourcePromptProcessLifecycle(callbacks, lifecycle()),
    (error: unknown) => {
      assert.ok(error instanceof SourcePromptStartupError);
      assert.equal(error.cause, startupError);
      assert.equal(error.child, child);
      return true;
    }
  );
});

test("keeps the accepted child exit observable when initial persistence fails", async () => {
  const persistError = new Error("state save failed");
  const exitHandlers: Array<(event: { exitCode: number | null }) => void> = [];
  const finished: Array<{ exitCode: number | null; status: string }> = [];
  let pendingExitCode: number | null | undefined;
  const session = {
    adapterId: "codex",
    id: "session-1",
    inputHistory: [],
    replyState: { phase: "idle" }
  };

  const child = {
    onData: () => ({ dispose: () => {} }),
    onExit: (handler: (event: { exitCode: number | null }) => void) => {
      exitHandlers.push(handler);
      if (pendingExitCode !== undefined) handler({ exitCode: pendingExitCode });
      return { dispose: () => {} };
    },
    startupReady: Promise.resolve()
  };

  const callbacks = {
    appendStdoutLog: () => {},
    appendSystemLog: () => {},
    deleteChild: () => {},
    finishSession: (_sessionId: string, status: string, exitCode: number | null) => {
      finished.push({ exitCode, status });
    },
    getSession: () => ({ ...session, status: "running" }),
    isCurrentChild: () => true,
    markPromptAccepted: () => {},
    markPromptDispatching: () => {},
    persistState: async () => {
      pendingExitCode = 1;
      throw persistError;
    },
    spawnProcess: () => child,
    startGitPolling: () => {},
    stopGitPolling: () => {},
    updateSession: () => {}
  };

  await assert.rejects(
    runSourcePromptProcessLifecycle(callbacks as never, lifecycle({ session })),
    persistError
  );

  assert.equal(exitHandlers.length, 1);
  assert.deepEqual(finished, [{ exitCode: 1, status: "failed" }]);
});
