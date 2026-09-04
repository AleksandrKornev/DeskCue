import assert from "node:assert/strict";
import test from "node:test";

import {
  readSubagentPanelViewState,
  writeSubagentPanelViewState
} from "./viewState.ts";

test("preserves React Router state while storing parent list context", () => {
  const state = writeSubagentPanelViewState(
    { idx: 2, key: "route-key", usr: { retained: true } },
    {
      expanded: true,
      parentSessionId: "codex:parent",
      returnFocusSessionId: "codex:child",
      scrollTop: 180,
      windowScrollY: 240
    }
  );

  assert.deepEqual(state, {
    idx: 2,
    key: "route-key",
    usr: {
      retained: true,
      deskCueSubagentPanel: {
        expanded: true,
        parentSessionId: "codex:parent",
        returnFocusSessionId: "codex:child",
        scrollTop: 180,
        windowScrollY: 240
      }
    }
  });
  assert.deepEqual(readSubagentPanelViewState(state, "codex:parent"), {
    expanded: true,
    parentSessionId: "codex:parent",
    returnFocusSessionId: "codex:child",
    scrollTop: 180,
    windowScrollY: 240
  });
});

test("does not reuse panel context for another parent", () => {
  const state = writeSubagentPanelViewState(null, {
    expanded: true,
    parentSessionId: "codex:parent",
    returnFocusSessionId: "codex:child",
    scrollTop: 180,
    windowScrollY: 240
  });

  assert.deepEqual(readSubagentPanelViewState(state, "codex:other"), {
    expanded: false,
    parentSessionId: "codex:other",
    returnFocusSessionId: null,
    scrollTop: 0,
    windowScrollY: null
  });
});
