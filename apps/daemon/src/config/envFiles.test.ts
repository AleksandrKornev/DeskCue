import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadEnvFiles } from "./envFiles.ts";

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
