import express from "express";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import test from "node:test";

import { installWorkspaceRoutes } from "./workspaceRoutes.ts";

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function withServer(app: express.Express, callback: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

test("workspace picker rejects a loopback proxy request for an external browser origin", async () => {
  const app = express();
  installWorkspaceRoutes(app, {
    workspaces: {
      listWorkspaces() {
        return [];
      }
    } as never
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workspaces/pick`, {
      headers: {
        host: "deskcue.example.com",
        origin: "https://deskcue.example.com",
        "x-forwarded-for": "192.168.1.50"
      },
      method: "POST"
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Folder picker is only available from DeskCue on this computer."
    });
  });
});
