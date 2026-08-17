import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { daemonApiContract } from "./apiContract.ts";
import { ACCESS_TOKEN_OPTIONAL_ROUTES } from "../routes/access/accessControl.ts";

const HTTP_ROUTE_SOURCE_NAMES = [
  "routes/access",
  "routes/agents",
  "routes/system"
];

test("daemon API contract preserves route order and response metadata", () => {
  assert.equal(daemonApiContract.length, 109);
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(daemonApiContract))
      .digest("hex"),
    "0224e9a30f771df3629dea47facca37f503842216cfda3272de6503a71a410cb"
  );

  const contractRouteMap = new Map(
    daemonApiContract.map((route) => [`${route.method} ${route.path}`, route])
  );
  const contractRouteOrder = new Map(
    daemonApiContract.map((route, index) => [`${route.method} ${route.path}`, index])
  );

  const assertRoute = (method: string, path: string, successStatuses: number[]) => {
    const routeKey = `${method} ${path}`;
    const route = contractRouteMap.get(routeKey);
    assert.equal(route !== undefined, true, routeKey);
    assert.deepEqual(route, {
      method,
      path,
      successStatuses
    });
  };

  const assertOrder = (firstKey: string, secondKey: string) => {
    const getRouteIndex = (routeKey: string): number => {
      const index = contractRouteOrder.get(routeKey);
      if (index === undefined) {
        throw new Error(`${routeKey} route not found in daemon API contract`);
      }

      return index;
    };

    const firstIndex = getRouteIndex(firstKey);
    const secondIndex = getRouteIndex(secondKey);

    assert.ok(firstIndex < secondIndex, `${firstKey} should come before ${secondKey}`);
  };

  assertRoute("GET", "/api/health", [200]);
  assertRoute("GET", "/api/workspaces", [200]);
  assertRoute("POST", "/api/workspaces/pick", [200, 201]);
  assertRoute("GET", "/api/workspaces/:workspaceId/files", [200]);
  assertRoute("GET", "/api/workspaces/:workspaceId/file", [200]);
  assertRoute("POST", "/api/local-llm/chats/:chatId/preview", [200]);
  assertRoute("POST", "/api/local-llm/chats/:chatId/git/refresh", [200]);
  assertRoute("POST", "/api/runtimes/lm-studio/server/start", [200]);
  assertRoute("POST", "/api/runtimes/ollama/server/start", [200]);
  assertRoute("POST", "/api/push/subscriptions", [201]);
  assertRoute("GET", "/api/assets/ticket/:ticket", [200]);

  assertOrder("GET /api/health", "GET /api/workspaces");
  assertOrder("GET /api/workspaces", "POST /api/workspaces/pick");
  assertOrder("POST /api/workspaces/pick", "GET /api/workspaces/:workspaceId/files");
  assertOrder("GET /api/workspaces/:workspaceId/files", "GET /api/workspaces/:workspaceId/file");
});

test("daemon API contract has unique method and path pairs", () => {
  const routeKeys = daemonApiContract.map((route) => `${route.method} ${route.path}`);

  assert.equal(new Set(routeKeys).size, routeKeys.length);
});

async function readRouteSourceFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, {
    withFileTypes: true
  });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...(await readRouteSourceFiles(entryPath)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

async function readDeclaredRoutes() {
  const routes = new Set<string>();
  const httpDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );

  for (const sourceName of HTTP_ROUTE_SOURCE_NAMES) {
    const sourcePath = path.join(httpDirectory, sourceName);
    const filePaths = sourceName.endsWith(".ts")
      ? [sourcePath]
      : await readRouteSourceFiles(sourcePath);

    for (const filePath of filePaths) {
      const source = await readFile(filePath, "utf-8");
      for (const match of source.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
        routes.add(`${match[1].toUpperCase()} ${match[2]}`);
      }
    }
  }

  return routes;
}

test("daemon API contract lists every declared HTTP route", async () => {
  const declaredRoutes = new Set(
    daemonApiContract.map((route) => `${route.method} ${route.path}`)
  );
  const actualRoutes = await readDeclaredRoutes();

  assert.deepEqual([...declaredRoutes].sort(), [...actualRoutes].sort());
});

test("daemon API contract keeps success status metadata explicit", () => {
  for (const route of daemonApiContract) {
    assert.notEqual(route.successStatuses.length, 0, `${route.method} ${route.path}`);
    assert.deepEqual(
      route.successStatuses,
      [...new Set(route.successStatuses)].sort((left, right) => left - right),
      `${route.method} ${route.path}`
    );

    for (const statusCode of route.successStatuses) {
      assert.equal(
        statusCode >= 200 && statusCode < 300,
        true,
        `${route.method} ${route.path}`
      );
    }
  }
});

test("daemon API contract keeps auth bypasses explicit and narrow", () => {
  const declaredRoutes = new Set(
    daemonApiContract.map((route) => `${route.method} ${route.path}`)
  );

  assert.deepEqual(
    [...ACCESS_TOKEN_OPTIONAL_ROUTES].sort(),
    [
      "GET /api/access/link",
      "GET /api/access/link/:pairCode/status",
      "GET /api/assets/ticket/:ticket",
      "GET /api/health",
      "POST /api/access/pair",
      "POST /api/access/recover"
    ],
    "Review this list before exposing another unauthenticated route."
  );

  for (const route of ACCESS_TOKEN_OPTIONAL_ROUTES) {
    assert.equal(declaredRoutes.has(route), true, route);
  }
});
