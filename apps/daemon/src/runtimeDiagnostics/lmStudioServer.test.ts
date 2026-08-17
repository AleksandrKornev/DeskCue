import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeSummary } from "@deskcue/protocol";

import {
  getLmStudioModelReadiness,
  listLmStudioModels,
  prepareLmStudioModel,
  startLmStudioServer
} from "./lmStudioServer.ts";

const installedModelsJson = JSON.stringify([
  {
    type: "llm",
    displayName: "Qwen3 4B",
    modelKey: "qwen/qwen3-4b",
    path: "qwen/qwen3-4b"
  },
  {
    type: "embedding",
    displayName: "Embedding",
    modelKey: "embedding-model",
    path: "embedding-model"
  }
]);

const installedModelsWithVariantJson = JSON.stringify([
  {
    type: "llm",
    displayName: "Qwen3 4B",
    modelKey: "qwen/qwen3-4b",
    path: "qwen/qwen3-4b",
    variants: ["qwen/qwen3-4b@q4_k_m"],
    selectedVariant: "qwen/qwen3-4b@q4_k_m"
  }
]);

const stoppedRuntime: RuntimeSummary = {
  id: "lm-studio",
  label: "LM Studio",
  installed: true,
  running: false,
  endpoint: "http://127.0.0.1:1234",
  modelCount: 1,
  loadedModelCount: 0,
  lastActiveModel: "local-model",
  statusText: "installed, local server is off"
};

test("starts the LM Studio Local Server without loading a model", async () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const inspections = [stoppedRuntime, { ...stoppedRuntime, running: true }];
  const result = await startLmStudioServer({
    exists: async () => true,
    inspectRuntime: async () => inspections.shift() ?? { ...stoppedRuntime, running: true },
    runCommand: async (command, args) => {
      commands.push({ command, args });
    }
  });

  assert.equal(result.startRequested, true);
  assert.equal(result.alreadyRunning, false);
  assert.deepEqual(commands.map((item) => item.args), [["server", "start"]]);
});

test("accepts an asynchronous Local Server startup even if the CLI exits with an error", async () => {
  const inspections = [stoppedRuntime, { ...stoppedRuntime, running: true }];
  const result = await startLmStudioServer({
    exists: async () => true,
    inspectRuntime: async () => inspections.shift() ?? { ...stoppedRuntime, running: true },
    runCommand: async () => {
      throw new Error("LM Studio service is waking up");
    }
  });

  assert.equal(result.startRequested, true);
  assert.equal(result.runtime.running, true);
});

test("keeps polling when runtime inspection fails while LM Studio wakes up", async () => {
  const inspections = [
    stoppedRuntime,
    new Error("lms ls --json: Waking up LM Studio service"),
    { ...stoppedRuntime, running: true }
  ];
  const result = await startLmStudioServer({
    exists: async () => true,
    inspectRuntime: async () => {
      const next = inspections.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next ?? { ...stoppedRuntime, running: true };
    },
    runCommand: async () => undefined,
    wait: async () => undefined
  });

  assert.equal(result.runtime.running, true);
});

test("waits for the LM Studio CLI to reappear before starting the server", async () => {
  let existsCalls = 0;
  let waits = 0;
  const commands: string[][] = [];
  const inspections = [stoppedRuntime, { ...stoppedRuntime, running: true }];
  const result = await startLmStudioServer({
    exists: async () => {
      existsCalls += 1;
      return existsCalls >= 3;
    },
    inspectRuntime: async () => inspections.shift() ?? { ...stoppedRuntime, running: true },
    runCommand: async (_command, args) => {
      commands.push(args);
    },
    wait: async () => {
      waits += 1;
    }
  });

  assert.equal(waits, 2);
  assert.deepEqual(commands, [["server", "start"]]);
  assert.equal(result.runtime.running, true);
});

test("does not issue a start command when the Local Server is already running", async () => {
  const result = await startLmStudioServer({
    inspectRuntime: async () => ({ ...stoppedRuntime, running: true }),
    runCommand: async () => {
      throw new Error("should not run");
    }
  });

  assert.equal(result.startRequested, false);
  assert.equal(result.alreadyRunning, true);
});

test("prepares a chat model from a stopped Local Server in one operation", async () => {
  const commands: string[][] = [];
  const inspections = [
    stoppedRuntime,
    { ...stoppedRuntime, running: true },
    { ...stoppedRuntime, running: true },
    { ...stoppedRuntime, running: true, loadedModelCount: 1, lastActiveModel: "qwen/qwen3-4b" }
  ];

  const result = await prepareLmStudioModel("qwen/qwen3-4b", {
    exists: async () => true,
    inspectRuntime: async () => inspections.shift() ?? { ...stoppedRuntime, running: true, loadedModelCount: 1 },
    runCommand: async (_command, args) => {
      commands.push(args);
    },
    runCommandOutput: async () => installedModelsJson,
    runLoadedModelsOutput: async () => "[]",
    wait: async () => undefined
  });

  assert.deepEqual(commands, [[
    "server", "start"
  ], [
    "load", "qwen/qwen3-4b", "--exact", "--identifier", "qwen/qwen3-4b", "--yes"
  ]]);
  assert.equal(result.startRequested, true);
  assert.equal(result.modelLoadRequested, true);
  assert.deepEqual(result.model, {
    displayName: "Qwen3 4B",
    modelKey: "qwen/qwen3-4b",
    path: "qwen/qwen3-4b"
  });
  assert.equal(result.runtime.loadedModelCount, 1);
});

test("accepts an asynchronous model load even if the CLI exits with an error", async () => {
  const inspections = [
    { ...stoppedRuntime, running: true },
    { ...stoppedRuntime, running: true },
    { ...stoppedRuntime, running: true, loadedModelCount: 1, lastActiveModel: "qwen/qwen3-4b" }
  ];

  const loadedModels = ["[]", installedModelsJson];
  const result = await prepareLmStudioModel("qwen/qwen3-4b", {
    exists: async () => true,
    inspectRuntime: async () => inspections.shift()
      ?? { ...stoppedRuntime, running: true, loadedModelCount: 1 },
    runCommand: async () => {
      throw new Error("Loading model in detached LM Studio process");
    },
    runCommandOutput: async () => installedModelsJson,
    runLoadedModelsOutput: async () => loadedModels.shift() ?? installedModelsJson,
    wait: async () => undefined
  });

  assert.equal(result.modelLoadRequested, true);
  assert.equal(result.runtime.loadedModelCount, 1);
});

test("recovers a saved LM Studio variant while the catalog is still warming after server start", async () => {
  const commands: string[][] = [];
  const inspections = [
    stoppedRuntime,
    { ...stoppedRuntime, running: true },
    { ...stoppedRuntime, running: true },
    { ...stoppedRuntime, running: true, loadedModelCount: 1 }
  ];
  const catalogs = ["[]", installedModelsWithVariantJson];

  const result = await prepareLmStudioModel("qwen/qwen3-4b@q4_k_m", {
    exists: async () => true,
    inspectRuntime: async () => inspections.shift() ?? { ...stoppedRuntime, running: true, loadedModelCount: 1 },
    runCommand: async (_command, args) => {
      commands.push(args);
    },
    runCommandOutput: async () => catalogs.shift() ?? installedModelsWithVariantJson,
    runLoadedModelsOutput: async () => "[]",
    wait: async () => undefined
  });

  assert.equal(result.model.modelKey, "qwen/qwen3-4b");
  assert.deepEqual(commands, [[
    "server", "start"
  ], [
    "load", "qwen/qwen3-4b", "--exact", "--identifier", "qwen/qwen3-4b", "--yes"
  ]]);
});

test("keeps an already restored LM Studio model instead of loading a duplicate identifier", async () => {
  const commands: string[][] = [];
  const runningWithModel = { ...stoppedRuntime, running: true, loadedModelCount: 1 };
  const result = await prepareLmStudioModel("qwen/qwen3-4b", {
    exists: async () => true,
    inspectRuntime: async () => runningWithModel,
    runCommand: async (_command, args) => {
      commands.push(args);
    },
    runCommandOutput: async () => installedModelsJson,
    runLoadedModelsOutput: async () => installedModelsJson
  });

  assert.deepEqual(commands, []);
  assert.equal(result.modelLoadRequested, false);
});

test("lists only local LM Studio chat models with their exact paths", async () => {
  const models = await listLmStudioModels({
    exists: async () => true,
    inspectRuntime: async () => ({ ...stoppedRuntime, modelCount: 1, running: true }),
    runCommandOutput: async () => installedModelsJson
  });

  assert.deepEqual(models, [{
    displayName: "Qwen3 4B",
    modelKey: "qwen/qwen3-4b",
    path: "qwen/qwen3-4b"
  }]);
});

test("retries the LM Studio catalog while its CLI service is warming", async () => {
  const catalogs: Array<Error | string> = [
    new Error("service unavailable"),
    "[]",
    installedModelsJson
  ];
  let waits = 0;

  const models = await listLmStudioModels({
    exists: async () => true,
    inspectRuntime: async () => ({ ...stoppedRuntime, modelCount: 1 }),
    runCommandOutput: async () => {
      const next = catalogs.shift() ?? installedModelsJson;
      if (next instanceof Error) throw next;
      return next;
    },
    wait: async () => {
      waits += 1;
    }
  });

  assert.equal(waits, 2);
  assert.equal(models.length, 1);
  assert.equal(models[0]?.modelKey, "qwen/qwen3-4b");
});

test("waits for a transiently unavailable LM Studio CLI before reading models", async () => {
  let existsCalls = 0;
  let waits = 0;

  const models = await listLmStudioModels({
    exists: async () => {
      existsCalls += 1;
      return existsCalls >= 3;
    },
    inspectRuntime: async () => ({ ...stoppedRuntime, running: true }),
    runCommandOutput: async () => installedModelsJson,
    wait: async () => {
      waits += 1;
    }
  });

  assert.equal(waits, 2);
  assert.equal(models.length, 1);
});

test("does not report an installed LM Studio runtime as not installed when its CLI stays unavailable", async () => {
  await assert.rejects(
    () => listLmStudioModels({
      exists: async () => false,
      inspectRuntime: async () => ({ ...stoppedRuntime, running: true }),
      wait: async () => undefined
    }),
    (error: unknown) => {
      assert.match(String(error), /still starting/i);
      assert.doesNotMatch(String(error), /not installed/i);
      return true;
    }
  );
});

test("returns a genuinely empty LM Studio catalog without a warm-up delay", async () => {
  let waits = 0;

  const models = await listLmStudioModels({
    exists: async () => true,
    inspectRuntime: async () => ({ ...stoppedRuntime, modelCount: 0 }),
    runCommandOutput: async () => "[]",
    wait: async () => {
      waits += 1;
    }
  });

  assert.deepEqual(models, []);
  assert.equal(waits, 0);
});

test("waits for the full chat-model catalog instead of returning a partial warm-up result", async () => {
  const partialCatalog = JSON.stringify([
    JSON.parse(installedModelsJson)[0]
  ]);
  const fullCatalog = JSON.stringify([
    ...JSON.parse(installedModelsJson),
    {
      displayName: "Second model",
      modelKey: "publisher/second-model",
      path: "publisher/second-model",
      type: "llm"
    }
  ]);
  const catalogs = [partialCatalog, fullCatalog];
  let waits = 0;

  const models = await listLmStudioModels({
    exists: async () => true,
    inspectRuntime: async () => ({ ...stoppedRuntime, modelCount: 2, running: true }),
    runCommandOutput: async () => catalogs.shift() ?? fullCatalog,
    wait: async () => {
      waits += 1;
    }
  });

  assert.equal(waits, 1);
  assert.equal(models.length, 2);
});

test("checks the exact loaded model before a chat turn is created", async () => {
  const runningRuntime = { ...stoppedRuntime, running: true, loadedModelCount: 1 };
  assert.equal(await getLmStudioModelReadiness("qwen/qwen3-4b", {
    exists: async () => true,
    inspectRuntime: async () => runningRuntime,
    runLoadedModelsOutput: async () => installedModelsJson
  }), "ready");
  assert.equal(await getLmStudioModelReadiness("qwen/qwen3-4b", {
    exists: async () => true,
    inspectRuntime: async () => runningRuntime,
    runLoadedModelsOutput: async () => "[]"
  }), "model_unloaded");
  assert.equal(await getLmStudioModelReadiness("qwen/qwen3-4b", {
    exists: async () => true,
    inspectRuntime: async () => stoppedRuntime
  }), "server_off");
});

test("refuses an LM Studio display name that does not exactly identify a local model", async () => {
  await assert.rejects(
    () => prepareLmStudioModel("qwen3", {
      exists: async () => true,
      runCommandOutput: async () => installedModelsJson,
      startServer: async () => ({
        alreadyRunning: true,
        runtime: { ...stoppedRuntime, running: true },
        startRequested: false
      })
    }),
    /not linked to an exact locally installed model/
  );
});
