import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import test from "node:test";

const daemonRoot = resolve(import.meta.dirname, "..");

function listTypeScriptFiles(directoryPath: string): string[] {
  return readdirSync(directoryPath, {
    withFileTypes: true
  }).flatMap((entry) => {
    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath);
    }

    return entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function toRelativePath(filePath: string) {
  return relative(daemonRoot, filePath).replace(/\\/g, "/");
}

function findApplicationStoreImports() {
  return listTypeScriptFiles(resolve(daemonRoot, "application"))
    .filter((filePath) => !filePath.endsWith(`${sep}daemonApplication.ts`))
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /#backend\/deskCueStore|DeskCueStore/.test(source)
        ? [toRelativePath(filePath)]
        : [];
    });
}

function findMatches(rootNames: string[], pattern: RegExp) {
  return rootNames.flatMap((rootName) =>
    listTypeScriptFiles(resolve(daemonRoot, rootName)).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return pattern.test(source) ? [toRelativePath(filePath)] : [];
    })
  );
}

function listDirectFiles(directoryPath: string) {
  return readdirSync(directoryPath, {
    withFileTypes: true
  })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

test("daemon source keeps domain ownership boundaries", () => {
  assert.equal(existsSync(resolve(daemonRoot, "lib")), false, "src/lib must not be reintroduced");

  assert.deepEqual(
    listDirectFiles(resolve(daemonRoot, "sessions")),
    [],
    "session modules must live in owner folders under src/sessions"
  );

  assert.deepEqual(
    findMatches(["http", "realtime"], /#backend\/deskCueStore|DeskCueStore|storeBackedSessionBackend/),
    [],
    "transport layers must use application services instead of importing the store backend"
  );

  assert.deepEqual(
    findApplicationStoreImports(),
    [],
    "application services may import the concrete store only in daemonApplication.ts"
  );

  assert.deepEqual(
    findMatches(["application", "backend", "persistence", "sessions"], /from\s+["'](?:express|ws)["']|\bexpress\.Request\b|\bexpress\.Response\b|\bWebSocket\b/),
    [],
    "Express/WebSocket transport types must not leak into application/backend/persistence/session modules"
  );

  assert.deepEqual(
    findMatches(["agents", "application", "backend", "http", "infrastructure", "realtime", "runtimeDiagnostics", "server", "sessions", "workspaces"], /better-sqlite3/),
    [],
    "direct SQLite access must stay inside src/persistence; src/access owns its auth SQLite store separately"
  );

  assert.deepEqual(
    findMatches(["access"], /better-sqlite3/).filter((filePath) => filePath !== "access/accessDevices.ts"),
    [],
    "access SQLite access is allowed only in the isolated auth device store"
  );

  assert.deepEqual(
    findMatches(["http", "realtime"], /cors\(\s*\)/),
    [],
    "HTTP setup must use accessControl CORS options instead of open cors()"
  );
});
