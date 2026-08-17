import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { firstDefinedString, readJsonFile } from "./shared.ts";

test("finds first non-empty runtime field", () => {
  assert.equal(
    firstDefinedString(
      [
        { model: "  " },
        { agent_type: "claude-sonnet" },
        { model: "qwen" }
      ],
      ["model", "agent_type"]
    ),
    "claude-sonnet"
  );
});

test("reads runtime JSON files and returns null for invalid JSON", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-runtime-"));
  const validPath = path.join(tempDir, "valid.json");
  const invalidPath = path.join(tempDir, "invalid.json");

  await writeFile(validPath, JSON.stringify({ port: 1234 }), "utf8");
  await writeFile(invalidPath, "{bad json}", "utf8");

  try {
    assert.deepEqual(await readJsonFile(validPath), { port: 1234 });
    assert.equal(await readJsonFile(invalidPath), null);
    assert.equal(await readJsonFile(path.join(tempDir, "missing.json")), null);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
