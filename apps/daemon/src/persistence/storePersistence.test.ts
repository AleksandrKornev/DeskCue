import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceSummary } from "@deskcue/protocol";

import { emptyPersistedDeskCueState } from "./state/types.ts";
import type { PersistedDeskCueState } from "./state/types.ts";
import { DeskCuePersistence } from "./storePersistence.ts";

test("close flushes dirty state even when persistence is still debounced", async () => {
  const workspace: WorkspaceSummary = {
    branch: null,
    createdAt: "2026-08-05T00:00:00.000Z",
    id: "workspace-1",
    isGitRepo: false,
    name: "workspace",
    path: "C:\\workspace"
  };
  const savedStates: PersistedDeskCueState[] = [];
  let markedPersisted = false;
  const persistence = new DeskCuePersistence({
    legacyJsonStorage: {
      load: async () => emptyPersistedDeskCueState,
      save: async () => {}
    },
    listDirtyPersistedSessions: () => [],
    listDirtyWorkspaces: () => [workspace],
    listPartialSessionIds: () => [],
    listPersistedSessions: () => [],
    listWorkspaces: () => [workspace],
    markAllPersisted: () => {
      markedPersisted = true;
    },
    markPersisted: () => {
      markedPersisted = true;
    },
    stateStorage: {
      load: async () => emptyPersistedDeskCueState,
      save: async (state) => {
        savedStates.push(structuredClone(state));
      }
    }
  });

  persistence.schedulePersist();
  await persistence.close();

  assert.equal(savedStates.length, 1);
  assert.deepEqual(savedStates[0]?.workspaces, [workspace]);
  assert.equal(markedPersisted, true);
});

test("concurrent persist requests are serialized before close", async () => {
  let activeSaves = 0;
  let maximumActiveSaves = 0;
  let saveCount = 0;
  const persistence = new DeskCuePersistence({
    legacyJsonStorage: {
      load: async () => emptyPersistedDeskCueState,
      save: async () => {}
    },
    listDirtyPersistedSessions: () => [],
    listDirtyWorkspaces: () => [],
    listPartialSessionIds: () => [],
    listPersistedSessions: () => [],
    listWorkspaces: () => [],
    markAllPersisted: () => {},
    markPersisted: () => {},
    stateStorage: {
      load: async () => emptyPersistedDeskCueState,
      save: async () => {
        activeSaves += 1;
        maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves);
        await new Promise<void>((resolve) => setImmediate(resolve));
        activeSaves -= 1;
        saveCount += 1;
      }
    }
  });

  await Promise.all([
    persistence.persistNow({ full: true }),
    persistence.persistNow({ full: true })
  ]);
  await persistence.close();

  assert.equal(maximumActiveSaves, 1);
  assert.equal(saveCount, 2);
});
