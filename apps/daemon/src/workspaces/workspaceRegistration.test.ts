import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ServerEvent, WorkspaceSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";

import type { WorkspaceRegistrationCallbacks } from "./workspaceRegistration.ts";
import { registerWorkspace } from "./workspaceRegistration.ts";

type RegistrationHarness = {
  callbacks: WorkspaceRegistrationCallbacks;
  events: ServerEvent[];
  persisted: WorkspaceSummary[][];
  workspaces: WorkspaceSummary[];
};

function createRegistrationHarness(): RegistrationHarness {
  const events: ServerEvent[] = [];
  const persisted: WorkspaceSummary[][] = [];
  const workspaces: WorkspaceSummary[] = [];
  const registrationScope = {};

  return {
    callbacks: {
      emitServerEvent: (event) => events.push(event),
      findWorkspaceByPath: (workspacePath) =>
        workspaces.find((workspace) => workspace.path === workspacePath),
      persistState: async () => {
        persisted.push(structuredClone(workspaces));
      },
      registrationScope,
      rollbackWorkspace: (workspaceId) => {
        const index = workspaces.findIndex((workspace) => workspace.id === workspaceId);

        if (index >= 0) workspaces.splice(index, 1);
      },
      setWorkspace: (workspace) => workspaces.push(workspace)
    },
    events,
    persisted,
    workspaces
  };
}

async function withTemporaryDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "deskcue-workspace-registration-"));

  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("registers a readable directory once and reuses the existing workspace", async () => {
  await withTemporaryDirectory(async (directory) => {
    const harness = createRegistrationHarness();
    const created = await registerWorkspace(harness.callbacks, `  ${directory}  `);
    const duplicate = await registerWorkspace(harness.callbacks, directory);

    assert.equal(created.path, path.resolve(directory));
    assert.equal(duplicate, created);
    assert.equal(harness.workspaces.length, 1);
    assert.equal(harness.persisted.length, 1);
    assert.deepEqual(harness.events, [{ type: "workspace.created", payload: created }]);
  });
});

test("deduplicates concurrent registration across callback wrappers", async () => {
  await withTemporaryDirectory(async (directory) => {
    const harness = createRegistrationHarness();
    const secondCallbacks = { ...harness.callbacks };
    const [first, second] = await Promise.all([
      registerWorkspace(harness.callbacks, directory),
      registerWorkspace(secondCallbacks, directory)
    ]);

    assert.equal(second, first);
    assert.equal(harness.workspaces.length, 1);
    assert.equal(harness.persisted.length, 1);
    assert.deepEqual(harness.events, [{ type: "workspace.created", payload: first }]);
  });
});

test("rolls back a failed persistence attempt and retries registration", async () => {
  await withTemporaryDirectory(async (directory) => {
    const harness = createRegistrationHarness();
    let persistenceAttempts = 0;

    harness.callbacks.persistState = async () => {
      persistenceAttempts += 1;
      if (persistenceAttempts === 1) throw new Error("fixture persistence failure");

      harness.persisted.push(structuredClone(harness.workspaces));
    };

    await assert.rejects(
      registerWorkspace(harness.callbacks, directory),
      /fixture persistence failure/
    );

    assert.deepEqual(harness.workspaces, []);
    assert.deepEqual(harness.events, []);

    const retried = await registerWorkspace(harness.callbacks, directory);

    assert.equal(persistenceAttempts, 2);
    assert.deepEqual(harness.workspaces, [retried]);
    assert.deepEqual(harness.persisted, [[retried]]);
    assert.deepEqual(harness.events, [{ type: "workspace.created", payload: retried }]);
  });
});

test("rejects a file before mutating workspace state", async () => {
  await withTemporaryDirectory(async (directory) => {
    const harness = createRegistrationHarness();
    const filePath = path.join(directory, "not-a-workspace.txt");

    await writeFile(filePath, "fixture", "utf8");

    await assert.rejects(
      registerWorkspace(harness.callbacks, filePath),
      (error) =>
        error instanceof AppError &&
        error.code === "invalid_input" &&
        error.message === "Workspace path must be a directory."
    );

    assert.deepEqual(harness.workspaces, []);
    assert.deepEqual(harness.persisted, []);
    assert.deepEqual(harness.events, []);
  });
});

test("rejects a missing folder without exposing its local path", async () => {
  await withTemporaryDirectory(async (directory) => {
    const harness = createRegistrationHarness();
    const missingPath = path.join(directory, "private-missing-folder");

    await assert.rejects(
      registerWorkspace(harness.callbacks, missingPath),
      (error) =>
        error instanceof AppError &&
        error.code === "invalid_input" &&
        error.message === "Workspace folder was not found." &&
        !error.message.includes(missingPath)
    );

    assert.deepEqual(harness.workspaces, []);
    assert.deepEqual(harness.persisted, []);
    assert.deepEqual(harness.events, []);
  });
});
