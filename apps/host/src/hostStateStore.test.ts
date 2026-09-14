import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readPersistedHostState, writePersistedHostState } from "./hostStateStore.ts";

test("host desired daemon state defaults to running and persists explicit stop", () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-state-"));
  const path = join(root, "service", "host-state.json");

  try {
    assert.equal(readPersistedHostState(path).desiredDaemonRunning, true);
    writePersistedHostState(path, { desiredDaemonRunning: false });
    assert.equal(readPersistedHostState(path).desiredDaemonRunning, false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
