import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { readLastJsonlMatch } from "./localLlmChatFileStore.ts";
import { LocalLlmChatLibrary } from "./localLlmChatLibrary.ts";
import { LocalLlmChatRecovery } from "./localLlmChatRecovery.ts";
import { MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES } from "./localLlmChatStorageLimits.ts";
import { isLocalLlmChatMessage, parseLocalLlmChatManifest } from "./localLlmChatStorageSchema.ts";

const gzipAsync = promisify(gzip);

test("normalizes legacy local chat previews to device-direct routing", () => {
  const parsed = parseLocalLlmChatManifest({
    id: "chat-1",
    title: "Legacy chat",
    runtimeId: "ollama",
    model: "test-model",
    createdAt: "2026-08-06T10:00:00.000Z",
    updatedAt: "2026-08-06T10:00:00.000Z",
    preview: {
      active: true,
      artifacts: [],
      port: 5173,
      targetUrl: "http://127.0.0.1:5173"
    },
    version: 3
  }, "chat-1");

  assert.equal(parsed?.preview?.networkMode, "device-direct");
});

test("round-trips an exact-max message through bounded JSONL readers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-local-library-max-message-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "test-model" });
    const message = {
      id: "exact-max-message",
      role: "assistant" as const,
      status: "complete" as const,
      // Control characters exercise JSON's worst-case sixfold escaping rather
      // than validating only the friendly ASCII case.
      text: "\0".repeat(MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES),
      timestamp: "2026-08-06T10:00:00.000Z"
    };
    await library.appendMessage(chat.id, message);

    const page = await library.getChatHistoryPage(chat.id, {}, "history");
    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0]?.text, message.text);

    const recovered = await readLastJsonlMatch(
      path.join(root, chat.id, "messages.jsonl"),
      isLocalLlmChatMessage,
      (candidate) => candidate.id === message.id
    );
    assert.equal(recovered?.text, message.text);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("projects bounded initial/live tails while history remains fully pageable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-local-library-history-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "test-model" });
    const chatPath = path.join(root, chat.id);
    const timestamp = new Date().toISOString();
    const messages = Array.from({ length: 90 }, (_, index) => ({
      id: `message-${String(index).padStart(4, "0")}`,
      role: index % 2 === 0 ? "user" : "assistant",
      status: "complete",
      text: `message ${index}`,
      timestamp
    }));
    const longSummary = "reasoning ".repeat(16 * 1024);
    const events = Array.from({ length: 30 }, (_, index) => ({
      id: `event-${String(index).padStart(4, "0")}`,
      turnId: `turn-${String(index).padStart(4, "0")}`,
      type: "model_reasoning_saved",
      timestamp,
      summary: index === 29 ? longSummary : `reasoning ${index}`
    }));
    const changeSets = Array.from({ length: 6 }, (_, index) => ({
      id: `changeset-${String(index).padStart(4, "0")}`,
      turnId: `turn-${String(index).padStart(4, "0")}`,
      timestamp,
      changedFiles: [`file-${index}.ts`],
      diff: `diff ${index}`,
      attribution: "workspace_state_observed_between_snapshots"
    }));
    await writeFile(path.join(chatPath, "messages.jsonl"), `${messages.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
    await writeFile(path.join(chatPath, "events.jsonl"), `${events.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
    await writeFile(path.join(chatPath, "change-sets.jsonl"), `${changeSets.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");

    const initial = await library.getChatHistoryPage(chat.id, {}, "initial");
    const live = await library.getChatHistoryPage(chat.id, {}, "live");
    const history = await library.getChatHistoryPage(chat.id, {}, "history");

    assert.deepEqual([initial.messages.length, initial.events.length, initial.changeSets.length], [16, 20, 4]);
    assert.deepEqual([live.messages.length, live.events.length, live.changeSets.length], [3, 8, 2]);
    assert.deepEqual([history.messages.length, history.events.length, history.changeSets.length], [80, 30, 6]);
    assert.match(initial.events.at(-1)?.summary ?? "", /Details truncated in the live update/);
    assert.match(live.events.at(-1)?.summary ?? "", /Details truncated in the live update/);
    assert.equal(history.events.at(-1)?.summary, longSummary);
    assert.equal(history.history.messages.hasMore, true);

    const older = await library.getChatHistoryPage(chat.id, { messages: history.history.messages.nextCursor }, "history");
    assert.equal(older.messages.length, 10);
    assert.equal(older.history.messages.hasMore, false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("hydrates gzip change-set sidecars and completes an interrupted journal transaction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-local-library-sidecar-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "lm-studio", model: "test-model" });
    const timestamp = new Date().toISOString();
    const firstDiff = "*** first full diff ***\n".repeat(128);
    await library.appendChangeSet(chat.id, {
      id: "changeset-0001",
      turnId: "turn-0001",
      timestamp,
      changedFiles: ["first.ts"],
      diff: firstDiff,
      attribution: "applied_by_deskcue_local_agent"
    });
    assert.equal(await library.readChangeSetDiff(chat.id, "changeset-0001"), firstDiff);

    const chatPath = path.join(root, chat.id);
    const sidecarDirectory = path.join(chatPath, "change-diffs");
    const recovered = {
      id: "changeset-0002",
      turnId: "turn-0002",
      timestamp,
      changedFiles: ["recovered.ts"],
      diff: "",
      diffStorage: "gzip_sidecar",
      attribution: "workspace_state_observed_between_snapshots"
    };
    const recoveredDiff = "*** recovered full diff ***\n".repeat(128);
    await mkdir(sidecarDirectory, { recursive: true });
    await writeFile(path.join(sidecarDirectory, "changeset-0002.patch.gz"), await gzipAsync(recoveredDiff));
    await writeFile(
      path.join(chatPath, "change-set-journal.json"),
      `${JSON.stringify({ changeSet: recovered, sidecarFile: "changeset-0002.patch.gz" }, null, 2)}\n`,
      "utf8"
    );

    await library.recoverInterruptedStreams();

    assert.equal(await library.readChangeSetDiff(chat.id, "changeset-0002"), recoveredDiff);
    assert.deepEqual((await library.readChangeSets(chat.id)).map(({ id }) => id), ["changeset-0001", "changeset-0002"]);
    await assert.rejects(readFile(path.join(chatPath, "change-set-journal.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("recovers an uncheckpointed active turn once and clears its continuation state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-local-library-active-recovery-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "test-model" });
    await library.beginTurn(chat.id, {
      assistantMessageId: "assistant-recovery",
      startedAt: "2026-08-05T08:00:00.000Z",
      turnId: "turn-recovery",
      userMessageId: "user-recovery"
    });
    await library.saveAgentContinuation(chat.id, {
      assistantText: "not checkpointed",
      messages: [],
      nextRound: 1,
      turnId: "turn-recovery"
    });

    await library.recoverInterruptedStreams();
    await library.recoverInterruptedStreams();

    const manifest = await library.getManifest(chat.id);
    const events = await library.readEvents(chat.id);
    assert.equal(manifest.activeTurn, undefined);
    assert.equal(manifest.agentContinuation, undefined);
    assert.equal(
      events.filter((event) => event.type === "turn_interrupted_after_restart").length,
      1
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("startup recovery lookup scans recent JSONL records from a bounded tail", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-local-library-reverse-lookup-"));
  const filePath = path.join(root, "messages.jsonl");
  try {
    const target = {
      id: "target-message",
      role: "assistant",
      status: "complete",
      text: "recovered",
      timestamp: "2026-08-05T08:00:00.000Z"
    };
    const laterMessages = Array.from({ length: 100 }, (_, index) => ({
      ...target,
      id: `later-${index}`,
      text: `${index}:${"tail".repeat(256)}`
    }));
    await writeFile(
      filePath,
      `${"x".repeat(6 * 1024 * 1024)}\n${JSON.stringify(target)}\n` +
        `${laterMessages.map((message) => JSON.stringify(message)).join("\n")}\n`,
      "utf8"
    );

    const message = await readLastJsonlMatch(
      filePath,
      isLocalLlmChatMessage,
      (candidate) => candidate.id === target.id
    );
    assert.equal(message?.id, target.id);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Local LLM recovery.");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("startup recovery bounds parallel chat inspection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-local-library-recovery-concurrency-"));
  const gate = createDeferred<void>();
  let activeReads = 0;
  let maxActiveReads = 0;
  try {
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      mkdir(path.join(root, `chat-${String(index).padStart(8, "0")}`), { recursive: true })
    ));
    const recovery = new LocalLlmChatRecovery(
      root,
      {
        read: async () => {
          activeReads += 1;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          await gate.promise;
          activeReads -= 1;
          return { activeTurn: undefined };
        }
      } as never,
      {
        appendEvent: async () => undefined,
        appendRecoveredAssistant: async () => undefined,
        hasMessage: async () => false,
        hasTerminalEvent: async () => false
      }
    );

    const recoveryPromise = recovery.recoverInterruptedStreams();
    await waitFor(() => activeReads === 4);
    assert.equal(maxActiveReads, 4);
    gate.resolve();
    await recoveryPromise;
    assert.equal(maxActiveReads, 4);
  } finally {
    gate.resolve();
    await rm(root, { force: true, recursive: true });
  }
});
