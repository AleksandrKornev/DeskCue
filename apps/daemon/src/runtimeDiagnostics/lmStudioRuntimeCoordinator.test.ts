import assert from "node:assert/strict";
import test from "node:test";

import { LmStudioRuntimeCoordinator } from "./lmStudioRuntimeCoordinator.ts";

test("LM Studio coordinator deduplicates server start and preparation per model", async () => {
  let releaseStart!: () => void;
  let startCalls = 0;
  let prepareCalls = 0;
  const coordinator = new LmStudioRuntimeCoordinator({
    startServer: async () => {
      startCalls += 1;
      await new Promise<void>((resolve) => { releaseStart = resolve; });
      return { startRequested: true } as never;
    },
    prepareModel: async () => {
      prepareCalls += 1;
      return { modelLoadRequested: true } as never;
    }
  });

  const firstStart = coordinator.startServer();
  const secondStart = coordinator.startServer();
  assert.equal(firstStart, secondStart);
  await Promise.resolve();
  releaseStart();
  await firstStart;
  assert.equal(startCalls, 1);

  const [firstPrepare, secondPrepare] = await Promise.all([
    coordinator.prepareModel("model-a"),
    coordinator.prepareModel("model-a")
  ]);
  assert.equal(firstPrepare, secondPrepare);
  assert.equal(prepareCalls, 1);
  await coordinator.close();
});

test("LM Studio coordinator bounds admission and aborts queued work on close", async () => {
  const observed = { signal: null as AbortSignal | null };
  const coordinator = new LmStudioRuntimeCoordinator({
    concurrency: 1,
    queueCapacity: 1,
    listModels: async (signal) => {
      observed.signal = signal ?? null;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      return [];
    }
  });

  const active = coordinator.listModels();
  const queued = coordinator.startServer();
  await assert.rejects(coordinator.prepareModel("overflow"), /queue is full/i);
  const closing = coordinator.close();
  await assert.rejects(active, /closing/i);
  await assert.rejects(queued, /shutting down/i);
  await closing;
  assert.equal(observed.signal?.aborted, true);
});

test("different model preparations share one underlying server start", async () => {
  let startCalls = 0;
  const coordinator = new LmStudioRuntimeCoordinator({
    concurrency: 2,
    prepareModel: async (_model, _signal, startServer) => {
      await startServer?.();
      return { modelLoadRequested: true } as never;
    },
    startServer: async () => {
      startCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { startRequested: true } as never;
    }
  });

  await Promise.all([
    coordinator.prepareModel("model-a"),
    coordinator.prepareModel("model-b")
  ]);
  assert.equal(startCalls, 1);
  await coordinator.close();
});

test("concurrent catalog reads share one LM Studio CLI operation", async () => {
  let releaseList!: () => void;
  let listCalls = 0;
  const coordinator = new LmStudioRuntimeCoordinator({
    listModels: async () => {
      listCalls += 1;
      await new Promise<void>((resolve) => { releaseList = resolve; });
      return [];
    }
  });

  const firstList = coordinator.listModels();
  const secondList = coordinator.listModels();
  assert.equal(firstList, secondList);
  await Promise.resolve();
  releaseList();
  await firstList;
  assert.equal(listCalls, 1);
  await coordinator.close();
});
