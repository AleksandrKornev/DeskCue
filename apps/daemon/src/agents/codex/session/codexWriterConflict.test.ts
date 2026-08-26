import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";

import { hasCodexActiveWriterConflict } from "./codexWriterConflict.ts";

function conflictSession(text: string, timestamp = "2026-08-23T13:23:23.000Z") {
  return {
    adapterId: "codex",
    sourceSessionId: "source-1",
    logs: [{
      id: "log-1",
      stream: "stderr" as const,
      text,
      timestamp
    }]
  } satisfies Pick<SessionDetail, "adapterId" | "logs" | "sourceSessionId">;
}

test("recognizes a Codex thread-store active-writer conflict", () => {
  assert.equal(hasCodexActiveWriterConflict(conflictSession(
    "thread-store conflict: thread source-1 already has an active writer"
  )), true);
});

test("does not reinterpret an unrelated Codex error as an ownership conflict", () => {
  assert.equal(hasCodexActiveWriterConflict(conflictSession(
    "thread/resume failed: model request failed"
  )), false);
});

test("ignores an active-writer conflict from an earlier prompt attempt", () => {
  const session = conflictSession(
    "thread-store conflict: thread source-1 already has an active writer",
    "2026-08-23T13:23:23.000Z"
  );

  session.logs.push({
    id: "log-2",
    stream: "stderr",
    text: "thread/resume failed: model request failed",
    timestamp: "2026-08-23T13:30:01.000Z"
  });

  assert.equal(hasCodexActiveWriterConflict(session, {
    requestedAt: "2026-08-23T13:30:00.000Z"
  }), false);
});

test("recognizes an active-writer conflict from the current prompt attempt", () => {
  assert.equal(hasCodexActiveWriterConflict(conflictSession(
    "thread-store conflict: thread source-1 already has an active writer",
    "2026-08-23T13:30:01.000Z"
  ), {
    requestedAt: "2026-08-23T13:30:00.000Z"
  }), true);
});

test("does not assign an unbounded conflict when the current request timestamp is absent", () => {
  assert.equal(hasCodexActiveWriterConflict(conflictSession(
    "thread-store conflict: thread source-1 already has an active writer"
  ), {
    requestedAt: null
  }), false);
});
