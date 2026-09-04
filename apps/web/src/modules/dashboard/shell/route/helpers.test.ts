import assert from "node:assert/strict";
import test from "node:test";

import {
  canReturnToSubagentParent,
  createManagedSessionNavigation,
  createSubagentNavigationState,
  readSubagentParentHistoryDelta,
  readSubagentParentSessionId
} from "./helpers.ts";

test("recognizes the React Router history entry created for a subagent transition", () => {
  const state = {
    usr: createSubagentNavigationState("codex:parent", "codex:child", "history", 3),
    idx: 4
  };

  assert.equal(
    canReturnToSubagentParent(state, "codex:parent", "codex:child"),
    true
  );

  assert.equal(
    canReturnToSubagentParent(state, "codex:other", "codex:child"),
    false
  );

  assert.equal(readSubagentParentHistoryDelta(state, "codex:parent", "codex:child"), -1);
});

test("does not treat an unrelated or malformed history entry as a parent origin", () => {
  assert.equal(canReturnToSubagentParent(null, "codex:parent", "codex:child"), false);
  assert.equal(
    canReturnToSubagentParent(
      { usr: { deskCueSubagentNavigation: { parentSessionId: "codex:parent" } } },
      "codex:parent",
      "codex:child"
    ),
    false
  );
});

test("replaces a subagent source view while retaining only a real parent history origin", () => {
  const origin = createSubagentNavigationState("codex:parent", "codex:child", "history", 0);

  assert.deepEqual(
    createManagedSessionNavigation({ usr: origin, idx: 1 }, "codex:parent", "codex:child"),
    { replace: true, state: origin }
  );

  assert.deepEqual(
    createManagedSessionNavigation({ idx: 0 }, "codex:parent", "codex:child"),
    {
      replace: true,
      state: createSubagentNavigationState("codex:parent", "codex:child", "replace")
    }
  );

  assert.deepEqual(
    createManagedSessionNavigation({ idx: 0 }, undefined, "codex:child"),
    { replace: false, state: undefined }
  );

  assert.equal(readSubagentParentSessionId({ usr: origin }, "codex:child"), "codex:parent");
  assert.equal(readSubagentParentSessionId({ usr: origin }, "codex:other"), null);
});

test("returns directly to the parent after multiple child history entries", () => {
  const origin = createSubagentNavigationState("codex:parent", "codex:child", "history", 2);

  assert.equal(
    readSubagentParentHistoryDelta(
      { usr: origin, idx: 5 },
      "codex:parent",
      "codex:child"
    ),
    -3
  );

  assert.equal(
    canReturnToSubagentParent(
      { usr: origin, idx: 5 },
      "codex:parent",
      "codex:child"
    ),
    true
  );
});

test("falls back to replacement for stale or incomplete history markers", () => {
  const origin = createSubagentNavigationState("codex:parent", "codex:child");

  assert.equal(
    readSubagentParentHistoryDelta(
      { usr: origin, idx: 2 },
      "codex:parent",
      "codex:child"
    ),
    null
  );

  assert.equal(
    readSubagentParentHistoryDelta(
      {
        usr: createSubagentNavigationState("codex:parent", "codex:child", "history", 4),
        idx: 3
      },
      "codex:parent",
      "codex:child"
    ),
    null
  );
});

test("rejects an unknown subagent return mode", () => {
  const malformedState = {
    idx: 2,
    usr: {
      deskCueSubagentNavigation: {
        childSessionId: "codex:child",
        parentHistoryIndex: 0,
        parentSessionId: "codex:parent",
        returnMode: "unexpected"
      }
    }
  };

  assert.equal(
    readSubagentParentHistoryDelta(malformedState, "codex:parent", "codex:child"),
    null
  );

  assert.equal(readSubagentParentSessionId(malformedState, "codex:child"), null);
});
