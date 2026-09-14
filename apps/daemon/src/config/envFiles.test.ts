import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadDaemonEnvFiles, loadEnvFiles } from "./envFiles.ts";

function restoreEnvironmentValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

test("loads .env files without overriding shell environment values", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-env-files-"));
  const keys = [
    "DESKCUE_ENV_FILE_TEST",
    "DESKCUE_ENV_FILE_LOCAL_ONLY",
    "DESKCUE_ENV_FILE_COMMENT",
    "DESKCUE_ENV_FILE_QUOTED",
    "DESKCUE_ENV_FILE_SHELL"
  ];

  try {
    writeFileSync(
      join(tempDir, ".env"),
      [
        "DESKCUE_ENV_FILE_TEST=from-env",
        "DESKCUE_ENV_FILE_COMMENT=value-before-comment # comment",
        "DESKCUE_ENV_FILE_QUOTED=\"quoted value\"",
        "DESKCUE_ENV_FILE_SHELL=from-env"
      ].join("\n"),
      "utf8"
    );

    writeFileSync(
      join(tempDir, ".env.local"),
      [
        "DESKCUE_ENV_FILE_TEST=from-local",
        "DESKCUE_ENV_FILE_LOCAL_ONLY=local-only"
      ].join("\n"),
      "utf8"
    );

    process.env.DESKCUE_ENV_FILE_SHELL = "from-shell";
    loadEnvFiles([
      join(tempDir, ".env.local"),
      join(tempDir, ".env")
    ]);

    assert.deepEqual({
      comment: process.env.DESKCUE_ENV_FILE_COMMENT,
      localOnly: process.env.DESKCUE_ENV_FILE_LOCAL_ONLY,
      quoted: process.env.DESKCUE_ENV_FILE_QUOTED,
      shell: process.env.DESKCUE_ENV_FILE_SHELL,
      test: process.env.DESKCUE_ENV_FILE_TEST
    }, {
      comment: "value-before-comment",
      localOnly: "local-only",
      quoted: "quoted value",
      shell: "from-shell",
      test: "from-local"
    });
  } finally {
    for (const key of keys) {
      delete process.env[key];
    }

    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("does not load repository or working-directory env files in packaged mode", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-packaged-env-files-"));
  const previousCwd = process.cwd();
  const previousPackagedMode = process.env.DESKCUE_PACKAGED;
  const packagedKey = "DESKCUE_PACKAGED_ENV_FILE_TEST";

  try {
    writeFileSync(join(tempDir, ".env"), `${packagedKey}=from-working-directory\n`, "utf8");
    process.chdir(tempDir);
    process.env.DESKCUE_PACKAGED = "true";
    delete process.env[packagedKey];

    loadDaemonEnvFiles();

    assert.equal(process.env[packagedKey], undefined);
  } finally {
    process.chdir(previousCwd);
    restoreEnvironmentValue("DESKCUE_PACKAGED", previousPackagedMode);
    delete process.env[packagedKey];
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("keeps working-directory env loading for source-checkout mode", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-source-env-files-"));
  const previousCwd = process.cwd();
  const previousPackagedMode = process.env.DESKCUE_PACKAGED;
  const sourceKey = "DESKCUE_SOURCE_ENV_FILE_TEST";

  try {
    writeFileSync(join(tempDir, ".env"), `${sourceKey}=from-working-directory\n`, "utf8");
    process.chdir(tempDir);
    delete process.env.DESKCUE_PACKAGED;
    delete process.env[sourceKey];

    loadDaemonEnvFiles();

    assert.equal(process.env[sourceKey], "from-working-directory");
  } finally {
    process.chdir(previousCwd);
    restoreEnvironmentValue("DESKCUE_PACKAGED", previousPackagedMode);
    delete process.env[sourceKey];
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});
