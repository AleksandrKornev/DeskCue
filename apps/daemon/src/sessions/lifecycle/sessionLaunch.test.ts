import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ServerEvent, SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import type { RunningChild } from "#sessions/process/sessionProcess";

import { launchManagedSession } from "./sessionLaunch.ts";

function createLaunchFixture(cwd: string, child?: RunningChild) {
  let session: SessionDetail | null = null;
  let persistCount = 0;
  const events: ServerEvent[] = [];
  const logs: string[] = [];
  const workspace = {
    id: "workspace-1",
    name: "Workspace",
    path: cwd
  } as WorkspaceSummary;
  const callbacks: Parameters<typeof launchManagedSession>[0] = {
    appendLog(_sessionId: string, _stream: string, text: string) {
      logs.push(text);
    },
    emitServerEvent(event: ServerEvent) {
      events.push(event);
    },
    finishSession(_sessionId: string, status: SessionDetail["status"], exitCode: number | null) {
      if (!session) return;
      session = {
        ...session,
        exitCode,
        finishedAt: new Date().toISOString(),
        status
      };
      events.push({ type: "session.updated", payload: session });
    },
    getChild: () => child,
    getPublicSession: () => session,
    getSession: () => session,
    isCurrentChild: () => true,
    async persistState() {
      persistCount += 1;
    },
    scheduleDelayedAction: (
      _sessionId: string,
      _action: () => Promise<void>,
      _delayMs: number
    ) => {},
    sendSourceInput: async () => session!,
    setSession(next: SessionDetail) {
      session = next;
    },
    spawnProcess: () => {
      if (!child) throw new Error("spawn failed");
      return child;
    },
    startGitPolling: () => {},
    supportsSourceInput: (adapterId) => adapterId === "codex" || adapterId === "claude-code",
    syncWorkspaceFromGit: () => {},
    toSummary: (value: SessionDetail) => value,
    updateSession(_sessionId: string, patch: Partial<SessionDetail>) {
      if (session) session = { ...session, ...patch };
    }
  };
  return {
    callbacks,
    events,
    get logs() {
      return logs;
    },
    get persistCount() {
      return persistCount;
    },
    get session() {
      return session;
    },
    workspace
  };
}

test("marks a persisted session failed when process spawn throws", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-launch-failure-"));
  const fixture = createLaunchFixture(cwd);

  try {
    await assert.rejects(
      launchManagedSession(fixture.callbacks, {
        adapterId: "generic-cli",
        command: "missing-command",
        cwd,
        env: {},
        sourceSessionId: null,
        workspace: fixture.workspace
      }),
      /spawn failed/
    );

    assert.equal(fixture.session?.status, "failed");
    assert.equal(fixture.session?.finishedAt !== null, true);
    assert.equal(fixture.persistCount >= 2, true);
    assert.match(fixture.logs.join(""), /Failed to start command: spawn failed/);
    assert.equal(
      fixture.events.some((event) => event.type === "session.updated"),
      true
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

function fakeChild(): RunningChild {
  return {
    kill() {},
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
    pid: 42,
    write() {}
  };
}

test("routes delayed Codex input through the owned scheduler and contains delivery failure", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-launch-input-"));
  const child = fakeChild();
  const fixture = createLaunchFixture(cwd, child);
  let scheduledAction: (() => Promise<void>) | null = null;
  fixture.callbacks.scheduleDelayedAction = (
    _sessionId: string,
    action: () => Promise<void>
  ) => {
    scheduledAction = action;
  };
  fixture.callbacks.sendSourceInput = async () => {
    throw new Error("delivery failed");
  };

  try {
    await launchManagedSession(fixture.callbacks, {
      adapterId: "codex",
      command: "codex resume source-1",
      cwd,
      env: {},
      initialInput: "hello",
      sourceSessionId: "source-1",
      workspace: fixture.workspace
    });

    assert.notEqual(scheduledAction, null);
    await scheduledAction!();

    assert.match(fixture.logs.join(""), /Initial input failed: delivery failed/);
    assert.equal(fixture.persistCount >= 2, true);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("journals argv input before spawning the detached agent process", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-launch-journal-"));
  const fixture = createLaunchFixture(cwd, fakeChild());
  const lifecycle: string[] = [];
  let preparedRequestedAt: string | undefined;
  fixture.callbacks.preparePromptDelivery = (_session, prompt, requestedAt) => {
    preparedRequestedAt = requestedAt;
    lifecycle.push(`prepare:${prompt}:${requestedAt}`);
    return "delivery-1";
  };
  fixture.callbacks.markPromptDispatching = (deliveryId) => {
    lifecycle.push(`dispatching:${deliveryId}`);
    return true;
  };
  fixture.callbacks.markPromptAccepted = (deliveryId) => {
    lifecycle.push(`accepted:${deliveryId}`);
    return true;
  };
  fixture.callbacks.spawnProcess = () => {
    lifecycle.push("spawn");
    return fakeChild();
  };
  fixture.callbacks.persistState = async () => {
    lifecycle.push("persist");
  };

  try {
    const launched = await launchManagedSession(fixture.callbacks, {
      adapterId: "codex",
      argvInput: "initial prompt",
      command: "codex exec initial prompt",
      cwd,
      env: {},
      sourceSessionId: "source-1",
      workspace: fixture.workspace
    });

    assert.deepEqual(lifecycle.map((entry) => entry.split(":", 1)[0]), [
      "prepare",
      "persist",
      "dispatching",
      "spawn",
      "accepted"
    ]);
    assert.equal(launched.replyState.phase, "sending");
    assert.equal(launched.replyState.requestedAt, preparedRequestedAt);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("marks argv input not sent when process spawn fails synchronously", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-launch-not-sent-"));
  const fixture = createLaunchFixture(cwd);
  const lifecycle: string[] = [];
  fixture.callbacks.preparePromptDelivery = () => {
    lifecycle.push("prepare");
    return "delivery-1";
  };
  fixture.callbacks.markPromptDispatching = () => {
    lifecycle.push("dispatching");
    return true;
  };
  fixture.callbacks.markPromptNotSentAfterSpawnFailure = () => {
    lifecycle.push("not_sent");
    return true;
  };

  try {
    await assert.rejects(
      launchManagedSession(fixture.callbacks, {
        adapterId: "codex",
        argvInput: "initial prompt",
        command: "missing-command",
        cwd,
        env: {},
        sourceSessionId: "source-1",
        workspace: fixture.workspace
      }),
      /spawn failed/
    );

    assert.deepEqual(lifecycle, ["prepare", "dispatching", "not_sent"]);
    assert.deepEqual(fixture.session?.promptRecovery, {
      phase: "not_sent",
      promptText: "initial prompt",
      requestedAt: fixture.session?.replyState.requestedAt,
      retryable: true
    });
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("keeps argv input outcome unknown when accepted persistence fails after spawn", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "deskcue-launch-accepted-failure-"));
  const fixture = createLaunchFixture(cwd, fakeChild());
  const lifecycle: string[] = [];
  fixture.callbacks.preparePromptDelivery = () => "delivery-1";
  fixture.callbacks.markPromptDispatching = () => true;
  fixture.callbacks.markPromptAccepted = () => {
    throw new Error("journal unavailable");
  };
  fixture.callbacks.markPromptNotSentAfterSpawnFailure = () => {
    lifecycle.push("not_sent");
    return true;
  };
  fixture.callbacks.markPromptOutcomeUnknown = () => {
    lifecycle.push("outcome_unknown");
    return true;
  };

  try {
    await assert.rejects(
      launchManagedSession(fixture.callbacks, {
        adapterId: "codex",
        argvInput: "initial prompt",
        command: "codex exec initial prompt",
        cwd,
        env: {},
        sourceSessionId: "source-1",
        workspace: fixture.workspace
      }),
      /journal unavailable/
    );

    assert.deepEqual(lifecycle, ["outcome_unknown"]);
    assert.equal(fixture.session?.promptRecovery?.phase, "outcome_unknown");
    assert.equal(fixture.session?.promptRecovery?.retryable, false);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
