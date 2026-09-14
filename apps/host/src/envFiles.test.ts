import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { loadHostEnvFiles } from "./envFiles.ts";

function createFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "deskcue-host-env-"));
  const modulePath = join(root, "apps", "host", "dist", "envFiles.js");

  mkdirSync(join(root, "apps", "host", "dist"), { recursive: true });

  return { moduleUrl: pathToFileURL(modulePath).href, root };
}

test("source Host loads stable repo-root env files with local precedence", () => {
  const fixture = createFixtureRoot();
  const env: NodeJS.ProcessEnv = {};

  try {
    writeFileSync(join(fixture.root, ".env"), "DESKCUE_DATA_DIR=repo-data\nBASE_ONLY=yes\n");
    writeFileSync(join(fixture.root, ".env.local"), "DESKCUE_DATA_DIR=local-data\n");

    loadHostEnvFiles({ env, moduleUrl: fixture.moduleUrl });

    assert.equal(env.DESKCUE_DATA_DIR, "local-data");
    assert.equal(env.BASE_ONLY, "yes");
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("installed Host ignores repo and current-working-directory env files", () => {
  const fixture = createFixtureRoot();
  const env: NodeJS.ProcessEnv = { DESKCUE_DISTRIBUTION_MODE: "installed" };

  try {
    writeFileSync(join(fixture.root, ".env.local"), "DESKCUE_DATA_DIR=unexpected\n");

    loadHostEnvFiles({ env, moduleUrl: fixture.moduleUrl });

    assert.equal(env.DESKCUE_DATA_DIR, undefined);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});
