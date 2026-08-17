import express from "express";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import test from "node:test";

import type { WorkspaceDirectoryQuery, WorkspaceFileQuery } from "@deskcue/protocol";

import { installWorkspaceFileRoutes } from "./workspaceFileRoutes.ts";
import { errorHandler } from "../../middleware/errorHandler.ts";

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function withServer(app: express.Express, callback: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

test("workspace file routes parse bounded query values and return service responses", async () => {
  const directoryRequests: unknown[] = [];
  const fileRequests: unknown[] = [];
  const app = express();
  installWorkspaceFileRoutes(app, {
    workspaceFiles: {
      async listDirectory(workspaceId: string, query: WorkspaceDirectoryQuery) {
        directoryRequests.push({ query, workspaceId });
        return {
          entries: [],
          hasMore: false,
          nextCursor: null,
          path: query.path,
          workspaceId
        };
      },
      async readFile(workspaceId: string, query: WorkspaceFileQuery) {
        fileRequests.push({ query, workspaceId });
        return {
          binary: false,
          content: "hello",
          modifiedAt: "2026-08-07T00:00:00.000Z",
          path: query.path,
          sizeBytes: 5,
          truncated: false,
          workspaceId
        };
      }
    } as never
  });
  app.use(errorHandler);

  await withServer(app, async (baseUrl) => {
    const directory = await fetch(
      `${baseUrl}/api/workspaces/workspace-1/files?path=src&cursor=n_YmV0YQ&limit=25`
    );
    assert.equal(directory.status, 200);
    assert.deepEqual(directoryRequests, [{
      query: { cursor: "n_YmV0YQ", limit: 25, path: "src" },
      workspaceId: "workspace-1"
    }]);

    const file = await fetch(
      `${baseUrl}/api/workspaces/workspace-1/file?path=src%2Findex.ts`
    );
    assert.equal(file.status, 200);
    assert.equal((await file.json() as { content: string }).content, "hello");
    assert.deepEqual(fileRequests, [{
      query: { path: "src/index.ts" },
      workspaceId: "workspace-1"
    }]);
  });
});

test("workspace file routes reject invalid pagination before reaching the service", async () => {
  let called = false;
  const app = express();
  installWorkspaceFileRoutes(app, {
    workspaceFiles: {
      async listDirectory() {
        called = true;
        throw new Error("Unexpected service call.");
      },
      async readFile() {
        called = true;
        throw new Error("Unexpected service call.");
      }
    } as never
  });
  app.use(errorHandler);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/workspace-1/files?limit=101`);
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});
