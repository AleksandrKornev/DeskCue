import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentSessionDetail, AgentTranscriptEntry, SessionDetail } from "@deskcue/protocol";
import { SqliteSourceTurnInterruptStore } from "#persistence/journals/sourceTurnInterruptStore";

import { SourceTurnInterruptLifecycle } from "./sourceTurnInterruptLifecycle.ts";

function managedSession() {
  return {
    adapterId: "codex",
    id: "managed-session",
    sourceSessionId: "source-session"
  } as SessionDetail;
}

function sourceSession(transcript: AgentTranscriptEntry[]) {
  return {
    agentId: "codex",
    sourceSessionId: "source-session",
    transcript,
    workState: "running"
  } as AgentSessionDetail;
}

function lifecycleEntry(
  id: string,
  timestamp: string,
  label: "Turn started" | "Turn completed" | "Turn failed" | "Turn interrupted"
): AgentTranscriptEntry {
  return {
    id,
    parts: [{ detail: null, label, type: "status" }],
    phase: null,
    role: "system",
    text: label,
    timestamp
  };
}

function textEntry(
  id: string,
  timestamp: string,
  text: string,
  role: AgentTranscriptEntry["role"]
): AgentTranscriptEntry {
  return { id, phase: null, role, text, timestamp };
}

test("keeps an interrupt requested until the matching source turn writes a terminal entry", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const store = new SqliteSourceTurnInterruptStore(join(tempDir, "state.sqlite"));
  const lifecycle = new SourceTurnInterruptLifecycle(store);
  const startedAt = "2026-07-30T10:00:00.000Z";

  try {
    lifecycle.request(managedSession(), {
      fingerprint: "turn-started",
      startedAt
    });

    const requested = lifecycle.decorate(sourceSession([
      lifecycleEntry("turn-started", startedAt, "Turn started"),
      textEntry("quiet-tool", "2026-07-30T10:10:00.000Z", "Still waiting", "tool")
    ]));
    assert.equal(requested.interruptLifecycle?.phase, "requested");
    assert.equal(requested.workState, "running");

    const confirmed = lifecycle.decorate(sourceSession([
      lifecycleEntry("turn-started", startedAt, "Turn started"),
      lifecycleEntry("turn-interrupted", "2026-07-30T10:10:01.000Z", "Turn interrupted")
    ]));
    assert.deepEqual(confirmed.interruptLifecycle, {
      phase: "confirmed",
      requestedAt: confirmed.interruptLifecycle?.requestedAt ?? null,
      confirmedAt: confirmed.interruptLifecycle?.confirmedAt ?? null,
      turnFingerprint: "turn-started",
      confirmation: "source_terminal",
      outcome: "interrupted"
    });
  } finally {
    lifecycle.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("confirms a closed DeskCue transport even when the source transcript has not caught up", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const store = new SqliteSourceTurnInterruptStore(join(tempDir, "state.sqlite"));
  const lifecycle = new SourceTurnInterruptLifecycle(store);

  try {
    lifecycle.request(managedSession(), {
      fingerprint: "turn-started",
      startedAt: "2026-07-30T10:00:00.000Z"
    });
    lifecycle.confirmManagedTransportExit(managedSession());

    const decorated = lifecycle.decorate(sourceSession([
      lifecycleEntry("turn-started", "2026-07-30T10:00:00.000Z", "Turn started")
    ]));
    assert.equal(decorated.interruptLifecycle?.phase, "confirmed");
    assert.equal(decorated.interruptLifecycle?.confirmation, "verified_process");
    assert.equal(decorated.interruptLifecycle?.outcome, "interrupted");
  } finally {
    lifecycle.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("keeps source reconciliation on the lifecycle entry but projects interruption onto the owned user entry", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const store = new SqliteSourceTurnInterruptStore(join(tempDir, "state.sqlite"));
  const lifecycle = new SourceTurnInterruptLifecycle(store);

  try {
    lifecycle.request(managedSession(), {
      fingerprint: "turn-started-current",
      startedAt: "2026-07-30T10:00:01.000Z",
      userEntryId: "user-current"
    });
    lifecycle.confirmManagedTransportExit(managedSession());

    const decorated = lifecycle.decorate(sourceSession([
      textEntry("user-previous", "2026-07-30T09:59:00.000Z", "previous", "user"),
      lifecycleEntry("turn-started-previous", "2026-07-30T09:59:01.000Z", "Turn started"),
      lifecycleEntry("turn-completed-previous", "2026-07-30T09:59:02.000Z", "Turn completed"),
      textEntry("user-current", "2026-07-30T10:00:00.000Z", "current", "user"),
      lifecycleEntry("turn-started-current", "2026-07-30T10:00:01.000Z", "Turn started")
    ]));

    assert.equal(decorated.interruptLifecycle?.turnFingerprint, "user-current");
    assert.equal(decorated.interruptLifecycle?.confirmation, "verified_process");
  } finally {
    lifecycle.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("does not keep a user-entry marker when a newer active source turn replaces it", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const store = new SqliteSourceTurnInterruptStore(join(tempDir, "state.sqlite"));
  const lifecycle = new SourceTurnInterruptLifecycle(store);

  try {
    lifecycle.request(managedSession(), {
      fingerprint: "turn-started-current",
      startedAt: "2026-07-30T10:00:01.000Z",
      userEntryId: "user-current"
    });

    const decorated = lifecycle.decorate(sourceSession([
      textEntry("user-current", "2999-07-30T10:00:00.000Z", "current", "user"),
      lifecycleEntry("turn-started-current", "2999-07-30T10:00:01.000Z", "Turn started"),
      lifecycleEntry("turn-completed-current", "2999-07-30T10:00:02.000Z", "Turn completed"),
      textEntry("user-newer", "2999-07-30T10:01:00.000Z", "newer", "user"),
      lifecycleEntry("turn-started-newer", "2999-07-30T10:01:01.000Z", "Turn started")
    ]));

    assert.equal(decorated.interruptLifecycle, undefined);
  } finally {
    lifecycle.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("preserves a normal terminal outcome after an interrupt request", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const store = new SqliteSourceTurnInterruptStore(join(tempDir, "state.sqlite"));
  const lifecycle = new SourceTurnInterruptLifecycle(store);

  try {
    lifecycle.request(managedSession(), {
      fingerprint: "turn-started",
      startedAt: "2026-07-30T10:00:00.000Z"
    });

    const decorated = lifecycle.decorate(sourceSession([
      lifecycleEntry("turn-started", "2026-07-30T10:00:00.000Z", "Turn started"),
      lifecycleEntry("turn-completed", "2026-07-30T10:01:00.000Z", "Turn completed")
    ]));

    assert.equal(decorated.interruptLifecycle?.phase, "confirmed");
    assert.equal(decorated.interruptLifecycle?.outcome, "completed");
  } finally {
    lifecycle.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("preserves failed source terminal outcome after an interrupt request", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const store = new SqliteSourceTurnInterruptStore(join(tempDir, "state.sqlite"));
  const lifecycle = new SourceTurnInterruptLifecycle(store);

  try {
    lifecycle.request(managedSession(), {
      fingerprint: "turn-started",
      startedAt: "2026-07-30T10:00:00.000Z"
    });

    const decorated = lifecycle.decorate(sourceSession([
      lifecycleEntry("turn-started", "2026-07-30T10:00:00.000Z", "Turn started"),
      lifecycleEntry("turn-failed", "2026-07-30T10:01:00.000Z", "Turn failed")
    ]));

    assert.equal(decorated.interruptLifecycle?.phase, "confirmed");
    assert.equal(decorated.interruptLifecycle?.outcome, "failed");
  } finally {
    lifecycle.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("does not confirm an interrupt from a newer source turn terminal", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const store = new SqliteSourceTurnInterruptStore(join(tempDir, "state.sqlite"));
  const lifecycle = new SourceTurnInterruptLifecycle(store);

  try {
    lifecycle.request(managedSession(), {
      fingerprint: "turn-started-1",
      startedAt: "2026-07-30T10:00:00.000Z"
    });

    const decorated = lifecycle.decorate(sourceSession([
      lifecycleEntry("turn-started-1", "2026-07-30T10:00:00.000Z", "Turn started"),
      lifecycleEntry("turn-completed-1", "2026-07-30T10:01:00.000Z", "Turn completed"),
      lifecycleEntry("turn-started-2", "2026-07-30T10:02:00.000Z", "Turn started"),
      lifecycleEntry("turn-completed-2", "2026-07-30T10:03:00.000Z", "Turn completed")
    ]));

    assert.equal(decorated.interruptLifecycle, undefined);
  } finally {
    lifecycle.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("confirms a verified external force stop until the source starts a newer turn", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const store = new SqliteSourceTurnInterruptStore(join(tempDir, "state.sqlite"));
  const lifecycle = new SourceTurnInterruptLifecycle(store);

  try {
    lifecycle.requestExternalForceStop(managedSession());

    const pending = lifecycle.decorate(sourceSession([
      lifecycleEntry("active-source-turn", "2020-01-01T00:00:00.000Z", "Turn started")
    ]));
    assert.equal(pending.interruptLifecycle?.phase, "confirmed");
    assert.equal(pending.interruptLifecycle?.confirmation, "verified_process");
    assert.equal(pending.interruptLifecycle?.outcome, "interrupted");

    const cleared = lifecycle.decorate(sourceSession([
      lifecycleEntry("new-source-turn", "2999-01-01T00:00:00.000Z", "Turn started")
    ]));
    assert.equal(cleared.interruptLifecycle, undefined);
  } finally {
    lifecycle.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("persists an active interrupt across daemon lifecycle recreation", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-source-turn-lifecycle-"));
  const databasePath = join(tempDir, "state.sqlite");
  let initialLifecycle: SourceTurnInterruptLifecycle | null = null;
  let reloadedLifecycle: SourceTurnInterruptLifecycle | null = null;

  try {
    initialLifecycle = new SourceTurnInterruptLifecycle(
      new SqliteSourceTurnInterruptStore(databasePath)
    );
    initialLifecycle.request(managedSession(), {
      fingerprint: "turn-started",
      startedAt: "2026-07-30T10:00:00.000Z"
    });
    initialLifecycle.close();
    initialLifecycle = null;

    reloadedLifecycle = new SourceTurnInterruptLifecycle(
      new SqliteSourceTurnInterruptStore(databasePath)
    );
    const decorated = reloadedLifecycle.decorate(sourceSession([
      lifecycleEntry("turn-started", "2026-07-30T10:00:00.000Z", "Turn started")
    ]));

    assert.equal(decorated.interruptLifecycle?.phase, "requested");
  } finally {
    initialLifecycle?.close();
    reloadedLifecycle?.close();
    await rm(tempDir, { force: true, recursive: true });
  }
});
