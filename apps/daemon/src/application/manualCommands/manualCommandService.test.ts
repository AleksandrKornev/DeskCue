import assert from "node:assert/strict";
import test from "node:test";

import { ManualCommandCapacityError } from "#sessions/manual/manualCommandRunner";

import { ManualCommandService } from "./manualCommandService.ts";

test("manual command service resolves workspace and owns runner close", async () => {
  const calls: string[] = [];
  const service = new ManualCommandService(
    {
      listWorkspaces: () => [{ id: "workspace-1", name: "Workspace", path: "D:\\work" }]
    } as never,
    {
      close: async () => {
        calls.push("close");
      },
      run: async (command, cwd) => {
        calls.push(`${command}:${cwd}`);
        return {
          durationMs: 0,
          exitCode: 0,
          ok: true,
          pid: 42,
          signal: null,
          status: "finished",
          stderr: "",
          stdout: "",
          truncated: false
        };
      }
    }
  );

  const result = await service.run("workspace-1", "npm test");
  await service.close();

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["npm test:D:\\work", "close"]);
});

test("manual command service rejects an unknown workspace before runner invocation", async () => {
  let invoked = false;
  const service = new ManualCommandService(
    { listWorkspaces: () => [] } as never,
    {
      async close() {},
      async run() {
        invoked = true;
        throw new Error("unexpected");
      }
    }
  );

  await assert.rejects(service.run("missing", "npm test"), /Workspace not found/);
  assert.equal(invoked, false);
});

test("manual command service exposes admission overflow as a conflict", async () => {
  const service = new ManualCommandService(
    {
      listWorkspaces: () => [{ id: "workspace-1", path: "D:\\work", name: "work" }]
    } as never,
    {
      close: async () => {},
      run: async () => {
        throw new ManualCommandCapacityError(4);
      }
    }
  );

  await assert.rejects(service.run("workspace-1", "npm test"), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "conflict");
    return true;
  });
});
