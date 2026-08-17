import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getClaudeSessionVersionFromProjectsRoot,
  listClaudeSessionsFromProjectsRoot
} from "./claudeDiscovery.ts";

test("discovers Claude sessions recursively and marks missing cwd as read-only", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-discovery-"));
  const nestedDir = path.join(tempDir, "project");

  await mkdir(nestedDir, { recursive: true });
  await writeFile(
    path.join(nestedDir, "session-a.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-06-22T08:00:00.000Z",
        cwd: "D:\\work\\repo",
        model: "claude-sonnet",
        message: {
          role: "user",
          content: "Ship it"
        }
      })
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(nestedDir, "session-b.jsonl"),
    JSON.stringify({
      timestamp: "2026-06-22T07:00:00.000Z",
      title: "Detached session"
    }),
    "utf8"
  );

  try {
    const sessions = await listClaudeSessionsFromProjectsRoot(tempDir);
    const version = await getClaudeSessionVersionFromProjectsRoot(tempDir, "session-a");

    assert.equal(sessions.length, 2);
    assert.equal(sessions[0]?.sourceSessionId, "session-a");
    assert.equal(sessions[0]?.attachMode, "resume");
    assert.equal(sessions[0]?.workspaceName, "repo");
    assert.equal(sessions[1]?.sourceSessionId, "session-b");
    assert.equal(sessions[1]?.attachMode, "read_only");
    assert.equal(version?.summary.sourceSessionId, "session-a");
    assert.equal(typeof version?.sourceFileSizeBytes, "number");
    assert.equal(typeof version?.sourceFileMtimeMs, "number");
    assert.match(version?.sourceVersion ?? "", /sourceFileSizeBytes/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("prefers Claude custom titles over generated titles and prompt fallbacks", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-titles-"));
  const nestedDir = path.join(tempDir, "project");

  await mkdir(nestedDir, { recursive: true });
  await writeFile(
    path.join(nestedDir, "session-custom.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-08-16T08:00:00.000Z",
        message: { role: "user", content: "Long first prompt" }
      }),
      JSON.stringify({ type: "ai-title", aiTitle: "Generated title" }),
      JSON.stringify({ type: "custom-title", customTitle: "First custom title" }),
      JSON.stringify({ type: "ai-title", aiTitle: "New generated title" }),
      JSON.stringify({ type: "custom-title", customTitle: "Current custom title" })
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(nestedDir, "session-generated.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-08-16T07:00:00.000Z",
        message: { role: "user", content: "Another long first prompt" }
      }),
      JSON.stringify({ type: "ai-title", aiTitle: "Current generated title" })
    ].join("\n"),
    "utf8"
  );

  try {
    const sessions = await listClaudeSessionsFromProjectsRoot(tempDir);
    const customSession = sessions.find(
      (session) => session.sourceSessionId === "session-custom"
    );
    const generatedSession = sessions.find(
      (session) => session.sourceSessionId === "session-generated"
    );

    assert.equal(customSession?.title, "Current custom title");
    assert.equal(generatedSession?.title, "Current generated title");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("discovers a large Claude session from bounded windows and uses its latest timestamp", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "deskcue-claude-large-discovery-"));
  const sessionPath = path.join(tempDir, "session-large.jsonl");
  const padding = JSON.stringify({ type: "progress", data: "x".repeat(700_000) });
  await writeFile(sessionPath, [
    JSON.stringify({
      cwd: "D:\\work\\large-repo",
      message: { role: "user", content: "Bounded discovery" },
      timestamp: "2026-06-22T08:00:00.000Z"
    }),
    padding,
    JSON.stringify({ type: "result", timestamp: "2026-06-22T09:30:00.000Z" })
  ].join("\n"), "utf8");

  try {
    const [session] = await listClaudeSessionsFromProjectsRoot(tempDir);
    assert.equal(session?.sourceSessionId, "session-large");
    assert.equal(session?.title, "Bounded discovery");
    assert.equal(session?.workspaceName, "large-repo");
    assert.equal(session?.updatedAt, "2026-06-22T09:30:00.000Z");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
