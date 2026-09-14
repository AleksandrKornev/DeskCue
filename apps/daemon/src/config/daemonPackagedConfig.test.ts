import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("packaged daemon config uses the stable platform data directory", {
  skip: process.platform === "darwin"
}, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-packaged-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { daemonConfig } from './src/config/daemonConfig.ts';",
          "console.log(JSON.stringify({",
          "databaseFilePath: daemonConfig.databaseFilePath,",
          "localChatLibraryPath: daemonConfig.localChatLibraryPath,",
          "stateFilePath: daemonConfig.stateFilePath",
          "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_DATABASE_FILE: undefined,
          DESKCUE_DATA_DIR: undefined,
          DESKCUE_LOCAL_CHAT_LIBRARY_DIR: undefined,
          DESKCUE_PACKAGED: "true",
          DESKCUE_STATE_FILE: undefined,
          LOCALAPPDATA: tempDir,
          XDG_DATA_HOME: tempDir
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout.trim()) as {
      databaseFilePath?: string;
      localChatLibraryPath?: string;
      stateFilePath?: string;
    };

    const dataRootPath = join(tempDir, "DeskCue", "data");

    assert.equal(payload.databaseFilePath, join(dataRootPath, "service", "deskcue.sqlite"));
    assert.equal(payload.localChatLibraryPath, join(dataRootPath, "deskcue-chats"));
    assert.equal(payload.stateFilePath, join(dataRootPath, "service", "state.json"));
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("explicit data directory overrides the packaged daemon default", () => {
  const localAppData = mkdtempSync(join(tmpdir(), "deskcue-config-packaged-local-"));
  const explicitDataRoot = mkdtempSync(join(tmpdir(), "deskcue-config-packaged-explicit-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { daemonConfig } from './src/config/daemonConfig.ts';",
          "console.log(daemonConfig.databaseFilePath);"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_DATABASE_FILE: undefined,
          DESKCUE_DATA_DIR: explicitDataRoot,
          DESKCUE_PACKAGED: "true",
          LOCALAPPDATA: localAppData
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), join(explicitDataRoot, "service", "deskcue.sqlite"));
  } finally {
    rmSync(localAppData, {
      force: true,
      recursive: true
    });
    rmSync(explicitDataRoot, {
      force: true,
      recursive: true
    });
  }
});
