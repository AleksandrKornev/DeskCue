import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getLocalChatLibraryPath,
  getServiceDataPath,
  migrateStorageLayout
} from "./storageLayout.ts";

test("does not create a data root or chat library during an empty first-start migration", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-storage-empty-"));
  const dataRootPath = join(tempDir, ".deskcue-data");

  try {
    migrateStorageLayout({
      dataRootPath
    });

    assert.equal(existsSync(dataRootPath), false);
    assert.equal(existsSync(getLocalChatLibraryPath(dataRootPath)), false);
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("migrates service state and the legacy sibling chat library without creating extra data", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-storage-layout-"));
  const dataRootPath = join(tempDir, ".deskcue-data");
  const legacyChatLibraryPath = join(tempDir, "deskcue-chats");

  try {
    mkdirSync(join(dataRootPath, "logs"), {
      recursive: true
    });
    writeFileSync(join(dataRootPath, "deskcue.sqlite"), "database", "utf8");
    writeFileSync(join(dataRootPath, "logs", "daemon.jsonl"), "log", "utf8");
    mkdirSync(join(legacyChatLibraryPath, "chat-1"), {
      recursive: true
    });
    writeFileSync(join(legacyChatLibraryPath, "chat-1", "chat.json"), "{}", "utf8");

    migrateStorageLayout({
      dataRootPath,
      legacyLocalChatLibraryPath: legacyChatLibraryPath
    });

    assert.equal(existsSync(join(getServiceDataPath(dataRootPath), "deskcue.sqlite")), true);
    assert.equal(existsSync(join(getServiceDataPath(dataRootPath), "logs", "daemon.jsonl")), true);
    assert.equal(existsSync(join(dataRootPath, "deskcue.sqlite")), false);
    assert.equal(existsSync(join(getLocalChatLibraryPath(dataRootPath), "chat-1", "chat.json")), true);
    assert.equal(existsSync(legacyChatLibraryPath), false);

    assert.doesNotThrow(() => {
      migrateStorageLayout({
        dataRootPath,
        legacyLocalChatLibraryPath: legacyChatLibraryPath
      });
    });
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("moves the former daemon-local data root into the DeskCue repository root", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-storage-root-"));
  const dataRootPath = join(tempDir, ".deskcue-data");
  const legacyDataRootPath = join(tempDir, "apps", "daemon", ".deskcue-data");

  try {
    mkdirSync(join(legacyDataRootPath, "service"), {
      recursive: true
    });
    mkdirSync(join(legacyDataRootPath, "deskcue-chats", "chat-1"), {
      recursive: true
    });
    writeFileSync(join(legacyDataRootPath, "service", "deskcue.sqlite"), "database", "utf8");
    writeFileSync(
      join(legacyDataRootPath, "deskcue-chats", "chat-1", "chat.json"),
      "{}",
      "utf8"
    );

    migrateStorageLayout({
      dataRootPath,
      legacyDataRootPath
    });

    assert.equal(existsSync(join(dataRootPath, "service", "deskcue.sqlite")), true);
    assert.equal(existsSync(join(dataRootPath, "deskcue-chats", "chat-1", "chat.json")), true);
    assert.equal(existsSync(legacyDataRootPath), false);
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("refuses to overwrite an existing chat library during migration", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-storage-layout-collision-"));
  const dataRootPath = join(tempDir, ".deskcue-data");
  const legacyChatLibraryPath = join(tempDir, "deskcue-chats");

  try {
    mkdirSync(legacyChatLibraryPath, {
      recursive: true
    });
    mkdirSync(getLocalChatLibraryPath(dataRootPath), {
      recursive: true
    });

    assert.throws(
      () => {
        migrateStorageLayout({
          dataRootPath,
          legacyLocalChatLibraryPath: legacyChatLibraryPath
        });
      },
      /destination already exists/
    );
    assert.equal(existsSync(legacyChatLibraryPath), true);
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});
