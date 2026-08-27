import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";
import { SessionRepository } from "#sessions/state/sessionRepository";

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
    listDirtyWorkspaces: () => [{ revision: 1, state: workspace }],
    listPartialSessionIds: () => [],
    listPersistedSessions: () => [],
    listWorkspaces: () => [{ revision: 1, state: workspace }],
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

test("persist acknowledgement does not clear newer repository revisions", async () => {
  const repository = new SessionRepository();
  const workspace: WorkspaceSummary = {
    branch: "main",
    createdAt: "2026-08-27T10:00:00.000Z",
    id: "workspace-1",
    isGitRepo: true,
    name: "Workspace",
    path: "D:/workspace"
  };

  const session: SessionDetail = {
    actionRequest: null,
    adapterId: "claude-code",
    command: "claude --resume source-claude",
    exitCode: 1,
    finishedAt: "2026-08-27T10:01:00.000Z",
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-27T10:01:00.000Z"
    },
    id: "session-1",
    inputHistory: ["previous prompt"],
    lastActivityAt: "2026-08-27T10:01:00.000Z",
    logs: [],
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    sourceSessionId: "source-claude",
    startedAt: "2026-08-27T10:00:00.000Z",
    status: "failed",
    workspaceId: workspace.id,
    workspaceName: workspace.name
  };

  const savedStates: PersistedDeskCueState[] = [];
  let releaseFirstSave!: () => void;
  let reportFirstSaveStarted!: () => void;
  const firstSaveStarted = new Promise<void>((resolve) => {
    reportFirstSaveStarted = resolve;
  });
  const firstSaveGate = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  const persistence = new DeskCuePersistence({
    legacyJsonStorage: {
      load: async () => emptyPersistedDeskCueState,
      save: async () => {}
    },
    listDirtyPersistedSessions: () =>
      repository.listSessionPersistenceSnapshots({ dirtyOnly: true }),
    listDirtyWorkspaces: () =>
      repository.listWorkspacePersistenceSnapshots({ dirtyOnly: true }),
    listPartialSessionIds: () => repository.listPartialSessionIds(),
    listPersistedSessions: () =>
      repository.listSessionPersistenceSnapshots({ dirtyOnly: false }),
    listWorkspaces: () =>
      repository.listWorkspacePersistenceSnapshots({ dirtyOnly: false }),
    markPersisted: (workspaces, sessions) =>
      repository.markPersistenceSnapshotsPersisted(workspaces, sessions),
    stateStorage: {
      load: async () => emptyPersistedDeskCueState,
      save: async (state) => {
        savedStates.push(structuredClone(state));
        if (savedStates.length !== 1) return;

        reportFirstSaveStarted();
        await firstSaveGate;
      }
    }
  });

  repository.setWorkspace(workspace);
  repository.setSession(session);
  const firstPersist = persistence.persistNow({ full: true });

  await firstSaveStarted;

  const newerWorkspace = { ...workspace, branch: "feature/newer" };
  const newerSession = { ...session, status: "running" as const };

  repository.setWorkspace(newerWorkspace);

  repository.setSession(newerSession);
  releaseFirstSave();
  await firstPersist;

  assert.deepEqual(repository.listDirtyWorkspaces(), [newerWorkspace]);
  assert.deepEqual(repository.listDirtyPersistedSessions(), [newerSession]);

  await persistence.persistNow({ full: true });

  assert.deepEqual(savedStates[0]?.workspaces, [workspace]);
  assert.deepEqual(savedStates[0]?.sessions, [session]);
  assert.deepEqual(savedStates[1]?.workspaces, [newerWorkspace]);
  assert.deepEqual(savedStates[1]?.sessions, [newerSession]);
  assert.deepEqual(repository.listDirtyWorkspaces(), []);
  assert.deepEqual(repository.listDirtyPersistedSessions(), []);
});
