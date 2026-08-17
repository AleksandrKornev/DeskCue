import express from "express";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { DEFAULT_WEB_DIST_PATH, installWebAppRoutes } from "./webAppRoutes.ts";

test("default web build path remains anchored at the web workspace", () => {
  assert.equal(
    resolve(DEFAULT_WEB_DIST_PATH),
    resolve(import.meta.dirname, "../../../../../web/dist")
  );
});

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

function withServer(app: express.Express, callback: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);

  return new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();
        assert(address && typeof address === "object");
        await callback(`http://127.0.0.1:${address.port}`);
        closeServer(server).then(resolve, reject);
      } catch (error) {
        closeServer(server).then(() => reject(error), reject);
      }
    });
  });
}

test("web app routes serve static assets and SPA fallbacks", async () => {
  const webDistPath = await mkdtemp(join(tmpdir(), "deskcue-web-dist-"));
  await writeFile(join(webDistPath, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
  await writeFile(join(webDistPath, "app.js"), "console.log('deskcue');", "utf8");

  const app = express();
  installWebAppRoutes(app, {
    webDistPath
  });

  try {
    await withServer(app, async (baseUrl) => {
      const root = await fetch(`${baseUrl}/`);
      const sessionRoute = await fetch(`${baseUrl}/sessions/session-1/chat`);
      const pairRoute = await fetch(`${baseUrl}/pair/code-1`);
      const asset = await fetch(`${baseUrl}/app.js`);
      const missingAsset = await fetch(`${baseUrl}/missing.js`);

      assert.equal(root.status, 200);
      assert.equal(await root.text(), "<!doctype html><div id=\"root\"></div>");
      assert.equal(sessionRoute.status, 200);
      assert.equal(pairRoute.status, 200);
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), "console.log('deskcue');");
      assert.equal(missingAsset.status, 404);
    });
  } finally {
    await rm(webDistPath, {
      force: true,
      recursive: true
    });
  }
});

test("web app routes explain missing web build", async () => {
  const app = express();
  installWebAppRoutes(app, {
    webDistPath: join(tmpdir(), "deskcue-missing-web-dist")
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.match(body, /DeskCue web app is not built/);
  });
});
