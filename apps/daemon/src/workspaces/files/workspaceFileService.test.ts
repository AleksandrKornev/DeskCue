import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkspaceSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";

import { WorkspaceFileService } from "./workspaceFileService.ts";

async function withWorkspace(
  callback: (context: { rootPath: string; service: WorkspaceFileService }) => Promise<void>
) {
  const rootPath = await mkdtemp(path.join(tmpdir(), "deskcue-workspace-files-"));
  const workspace: WorkspaceSummary = {
    branch: null,
    createdAt: "2026-08-07T00:00:00.000Z",
    id: "workspace-1",
    isGitRepo: false,
    name: "Workspace",
    path: rootPath
  };
  const service = new WorkspaceFileService({ listWorkspaces: () => [workspace] });

  try {
    await callback({ rootPath, service });
  } finally {
    await rm(rootPath, { force: true, recursive: true });
  }
}

test("lists workspace directories in bounded lazy pages", async () => {
  await withWorkspace(async ({ rootPath, service }) => {
    await Promise.all([
      writeFile(path.join(rootPath, "alpha.txt"), "alpha"),
      writeFile(path.join(rootPath, "beta.txt"), "beta"),
      mkdir(path.join(rootPath, "src"))
    ]);

    const first = await service.listDirectory("workspace-1", {
      cursor: null,
      limit: 2,
      path: ""
    });
    assert.equal(first.entries.length, 2);
    assert.equal(first.hasMore, true);
    assert.match(first.nextCursor ?? "", /^n_[A-Za-z0-9_-]+$/);

    const second = await service.listDirectory("workspace-1", {
      cursor: first.nextCursor,
      limit: 2,
      path: ""
    });
    assert.equal(second.entries.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(
      [...first.entries, ...second.entries].map((entry) => entry.name).sort(),
      ["alpha.txt", "beta.txt", "src"]
    );
  });
});

test("keeps cursor pagination stable when earlier directory entries change", async () => {
  await withWorkspace(async ({ rootPath, service }) => {
    await Promise.all([
      writeFile(path.join(rootPath, "alpha.txt"), "alpha"),
      writeFile(path.join(rootPath, "beta.txt"), "beta"),
      writeFile(path.join(rootPath, "delta.txt"), "delta")
    ]);
    const first = await service.listDirectory("workspace-1", {
      cursor: null,
      limit: 2,
      path: ""
    });
    await Promise.all([
      writeFile(path.join(rootPath, "aardvark.txt"), "new earlier entry"),
      writeFile(path.join(rootPath, "charlie.txt"), "new later entry")
    ]);

    const second = await service.listDirectory("workspace-1", {
      cursor: first.nextCursor,
      limit: 3,
      path: ""
    });

    assert.deepEqual(first.entries.map((entry) => entry.name), ["alpha.txt", "beta.txt"]);
    assert.deepEqual(second.entries.map((entry) => entry.name), ["charlie.txt", "delta.txt"]);
  });
});

test("returns bounded UTF-8 content and does not decode binary files", async () => {
  await withWorkspace(async ({ rootPath, service }) => {
    await writeFile(path.join(rootPath, "large.txt"), "x".repeat(300 * 1024));
    await writeFile(path.join(rootPath, "binary.dat"), Buffer.from([0, 1, 2, 3, 4]));

    const text = await service.readFile("workspace-1", { path: "large.txt" });
    assert.equal(text.binary, false);
    assert.equal(text.content?.length, 256 * 1024);
    assert.equal(text.sizeBytes, 300 * 1024);
    assert.equal(text.truncated, true);

    const binary = await service.readFile("workspace-1", { path: "binary.dat" });
    assert.equal(binary.binary, true);
    assert.equal(binary.content, null);
    assert.equal(binary.truncated, false);
  });
});

function isForbidden(error: unknown) {
  return error instanceof AppError && error.code === "forbidden";
}

function isInvalidInput(error: unknown) {
  return error instanceof AppError && error.code === "invalid_input";
}

test("rejects traversal, absolute paths and symlink escapes", async () => {
  const outsidePath = await mkdtemp(path.join(tmpdir(), "deskcue-files-outside-"));
  try {
    await writeFile(path.join(outsidePath, "secret.txt"), "secret");
    await withWorkspace(async ({ rootPath, service }) => {
      await symlink(
        outsidePath,
        path.join(rootPath, "outside-link"),
        process.platform === "win32" ? "junction" : "dir"
      );

      await assert.rejects(
        service.readFile("workspace-1", { path: "../secret.txt" }),
        isForbidden
      );
      await assert.rejects(
        service.readFile("workspace-1", { path: path.join(rootPath, "secret.txt") }),
        isInvalidInput
      );
      await assert.rejects(
        service.readFile("workspace-1", { path: "outside-link/secret.txt" }),
        isForbidden
      );

      const listed = await service.listDirectory("workspace-1", {
        cursor: null,
        limit: 10,
        path: ""
      });
      assert.deepEqual(
        listed.entries.find((entry) => entry.name === "outside-link"),
        {
          kind: "symlink",
          modifiedAt: listed.entries.find((entry) => entry.name === "outside-link")?.modifiedAt,
          name: "outside-link",
          path: "outside-link",
          readable: false,
          sizeBytes: null
        }
      );
    });
  } finally {
    await rm(outsidePath, { force: true, recursive: true });
  }
});

test("does not expose unregistered workspaces", async () => {
  await withWorkspace(async ({ service }) => {
    await assert.rejects(
      service.listDirectory("missing", { cursor: null, limit: 10, path: "" }),
      (error: unknown) => error instanceof AppError && error.code === "not_found"
    );
  });
});
