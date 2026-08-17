import assert from "node:assert/strict";
import test from "node:test";

import { inspectClaudeCodeRuntime } from "./claudeCode.ts";
import { inspectCodexRuntime } from "./codex.ts";
import { inspectLmStudioRuntime } from "./lmStudio.ts";
import { inspectOllamaRuntime, listOllamaModels } from "./ollama.ts";
import { firstDefinedString } from "./shared.ts";

test("inspects Ollama as running when the local API responds", async () => {
  const runtime = await inspectOllamaRuntime({
    exists: async () => true,
    fetchJson: async <T>(url: string) => (
      url.endsWith("/api/ps")
        ? { models: [{ name: "llama3:active" }] }
        : { models: [{ name: "llama3" }, { name: "qwen3" }] }
    ) as T
  });

  assert.equal(runtime.installed, true);
  assert.equal(runtime.running, true);
  assert.equal(runtime.modelCount, 2);
  assert.equal(runtime.loadedModelCount, 1);
  assert.equal(runtime.lastActiveModel, "llama3:active");
});

test("does not report an installed Ollama model as active when /api/ps is unavailable", async () => {
  const runtime = await inspectOllamaRuntime({
    exists: async () => true,
    fetchJson: async <T>(url: string) => (
      url.endsWith("/api/ps")
        ? null
        : { models: [{ name: "llama3" }] }
    ) as T
  });

  assert.equal(runtime.running, true);
  assert.equal(runtime.modelCount, 1);
  assert.equal(runtime.loadedModelCount, 0);
  assert.equal(runtime.lastActiveModel, null);
});

test("detects Ollama installed through PATH on any supported host platform", async () => {
  const runtime = await inspectOllamaRuntime({
    commandExists: async (command) => command === "ollama",
    exists: async () => false,
    fetchJson: async () => null
  });

  assert.equal(runtime.installed, true);
  assert.equal(runtime.running, false);
});

test("lists a bounded catalog of exact installed Ollama model keys", async () => {
  const models = await listOllamaModels({
    fetchJson: async <T>() => ({
      models: [
        { name: " qwen3:8b " },
        { model: "llama3.2:latest" },
        { name: "qwen3:8b" },
        { name: "x".repeat(513) },
        null,
        ...Array.from({ length: 300 }, (_, index) => ({ name: `model-${index}` }))
      ]
    }) as T
  });

  assert.deepEqual(models.slice(0, 2), [
    { displayName: "qwen3:8b", modelKey: "qwen3:8b" },
    { displayName: "llama3.2:latest", modelKey: "llama3.2:latest" }
  ]);
  assert.equal(models.length, 253);
  assert.equal(models.at(-1)?.modelKey, "model-250");
});

test("rejects an oversized Ollama model catalog before parsing JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", {
    headers: { "content-length": String(2 * 1024 * 1024 + 1) }
  });
  try {
    await assert.rejects(
      () => listOllamaModels(),
      /could not read the locally installed Ollama models/u
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("inspects LM Studio using configured port and only chat-capable native models", async () => {
  const runtime = await inspectLmStudioRuntime({
    exists: async () => true,
    fetchJson: async <T>(url: string) => (
      url.endsWith("/api/v1/models")
        ? {
          models: [
            { key: "embedding-model", type: "embedding", loaded_instances: [{ id: "embedding-model" }] },
            { key: "chat-model", type: "llm", loaded_instances: [{ id: "chat-model" }] }
          ]
        }
        : { data: [{ id: "chat-model" }] }
    ) as T,
    readJsonFile: async <T>(filePath: string) => {
      if (filePath.includes("http-server-config")) {
        return { port: 4321 } as T;
      }

      return {
        json: [
          ["older", { lastLoadedTimestamp: 1, transitive: false }],
          ["newer", { lastLoadedTimestamp: 2, transitive: true }]
        ]
      } as T;
    }
  });

  assert.equal(runtime.endpoint, "http://127.0.0.1:4321");
  assert.equal(runtime.running, true);
  assert.equal(runtime.modelCount, 1);
  assert.equal(runtime.loadedModelCount, 1);
  assert.equal(runtime.lastActiveModel, "chat-model");
});

test("inspects Claude Code live agents and tolerates malformed command output", async () => {
  const liveRuntime = await inspectClaudeCodeRuntime({
    commandExists: async () => true,
    exists: async () => false,
    execJsonCommand: async () => [
      { model: "claude-sonnet" },
      { agent_type: "fallback" }
    ],
    firstDefinedString
  });
  const malformedRuntime = await inspectClaudeCodeRuntime({
    commandExists: async () => true,
    exists: async () => false,
    execJsonCommand: async () => {
      throw new Error("bad json");
    },
    firstDefinedString
  });

  assert.equal(liveRuntime.running, true);
  assert.equal(liveRuntime.loadedModelCount, 2);
  assert.equal(liveRuntime.lastActiveModel, "claude-sonnet");
  assert.equal(malformedRuntime.running, false);
  assert.equal(malformedRuntime.loadedModelCount, 0);
});

test("inspects Codex installed state from binary or home fallback", async () => {
  const binaryRuntime = await inspectCodexRuntime({
    commandExists: async () => true,
    exists: async () => false
  });
  const homeRuntime = await inspectCodexRuntime({
    commandExists: async () => false,
    exists: async () => true
  });

  assert.equal(binaryRuntime.id, "codex");
  assert.equal(binaryRuntime.installed, true);
  assert.equal(homeRuntime.installed, true);
  assert.equal(homeRuntime.running, false);
});
