import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeSummary } from "@deskcue/protocol";

import { startOllamaServer } from "./ollamaServer.ts";

const stoppedRuntime: RuntimeSummary = {
  chatCapability: "unavailable",
  endpoint: "http://127.0.0.1:11434",
  id: "ollama",
  installed: true,
  label: "Ollama",
  lastActiveModel: null,
  loadedModelCount: 0,
  modelCount: 0,
  running: false,
  statusText: "installed, API not responding"
};

test("starts Ollama and waits for its local API before returning", async () => {
  const inspections = [
    stoppedRuntime,
    stoppedRuntime,
    { ...stoppedRuntime, chatCapability: "history_replay" as const, modelCount: 2, running: true }
  ];
  const launched: string[] = [];

  const result = await startOllamaServer({
    commandExists: async () => true,
    exists: async () => false,
    inspectRuntime: async () => inspections.shift() ?? inspections.at(-1)!,
    launchServer: async (command) => {
      launched.push(command);
    },
    wait: async () => undefined
  });

  assert.deepEqual(launched, ["ollama"]);
  assert.equal(result.startRequested, true);
  assert.equal(result.runtime.running, true);
  assert.equal(result.runtime.modelCount, 2);
});

test("does not launch another Ollama server when its API is already ready", async () => {
  let launchCalls = 0;
  const runningRuntime = { ...stoppedRuntime, running: true };

  const result = await startOllamaServer({
    inspectRuntime: async () => runningRuntime,
    launchServer: async () => {
      launchCalls += 1;
    }
  });

  assert.equal(launchCalls, 0);
  assert.equal(result.alreadyRunning, true);
  assert.equal(result.startRequested, false);
});

test("reports an unavailable Ollama installation without launching a process", async () => {
  await assert.rejects(
    () => startOllamaServer({
      commandExists: async () => false,
      exists: async () => false,
      inspectRuntime: async () => ({ ...stoppedRuntime, installed: false })
    }),
    /not installed/u
  );
});
