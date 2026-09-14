import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadCliEnvFiles } from "./envFiles.ts";

test("packaged CLI ignores env files in the current project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-cli-env-"));
  const originalCwd = process.cwd();
  const previousMarker = process.env.DESKCUE_CLI_CWD_MARKER;
  const previousMode = process.env.DESKCUE_DISTRIBUTION_MODE;

  try {
    await writeFile(join(directory, ".env"), "DESKCUE_CLI_CWD_MARKER=untrusted\n", "utf8");
    process.chdir(directory);
    process.env.DESKCUE_DISTRIBUTION_MODE = "installed";
    delete process.env.DESKCUE_CLI_CWD_MARKER;

    loadCliEnvFiles();

    assert.equal(process.env.DESKCUE_CLI_CWD_MARKER, undefined);
  } finally {
    process.chdir(originalCwd);
    if (previousMarker === undefined) delete process.env.DESKCUE_CLI_CWD_MARKER;
    else process.env.DESKCUE_CLI_CWD_MARKER = previousMarker;
    if (previousMode === undefined) delete process.env.DESKCUE_DISTRIBUTION_MODE;
    else process.env.DESKCUE_DISTRIBUTION_MODE = previousMode;
    await rm(directory, { force: true, recursive: true });
  }
});
