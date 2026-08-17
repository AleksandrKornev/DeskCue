import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import type { ServerEvent } from "@deskcue/protocol";

import { LocalLlmChatService } from "./localLlmChatService.ts";
import type { LocalLlmChatTransport } from "./localLlmChatService.ts";
import type {
  LocalLlmAgentTransport,
  LocalLlmToolCapabilityProbe
} from "../generation/localLlmAgentTransport.ts";
import {
  LocalLlmChatLibrary,
  MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES,
  MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES
} from "../storage/localLlmChatLibrary.ts";
import { LocalLlmToolExecutor } from "../tools/localLlmToolExecutor.ts";

const gzipAsync = promisify(gzip);
const execFileAsync = promisify(execFile);

async function createGitWorkspace(workspacePath: string) {
  await mkdir(workspacePath, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: workspacePath });
  await execFileAsync("git", ["config", "user.email", "deskcue-test@example.test"], { cwd: workspacePath });
  await execFileAsync("git", ["config", "user.name", "DeskCue test"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "tracked.txt"), "initial\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: workspacePath });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspacePath });
}

async function waitFor<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (matches(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // A heavily loaded parallel suite may resume the timer callback just after
  // the wall-clock deadline even though the asynchronous state transition
  // completed meanwhile. Observe the state once more before reporting a real
  // timeout; this keeps the deadline without turning scheduler delay into a
  // false negative.
  const finalValue = await read();
  if (matches(finalValue)) {
    return finalValue;
  }
  throw new Error("Timed out waiting for local chat state.");
}

async function waitForLocalLlmServiceIdle(service: LocalLlmChatService) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!service.hasActiveGenerations()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!service.hasActiveGenerations()) {
    return;
  }
  throw new Error("Timed out waiting for local generation lifecycle to drain.");
}

function withTestTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: NodeJS.Timeout | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function testWorkspace() {
  return {
    id: "workspace-1",
    name: "DeskCue",
    path: "C:/projects/example-workspace",
    isGitRepo: true,
    branch: "main",
    createdAt: "2026-08-01T07:00:00.000Z"
  };
}

test("persists local chat messages in the dedicated deskcue-chats library", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const transport: LocalLlmChatTransport = {
      async generate({ onDelta }) {
        onDelta("Local answer");
      }
    };
    const service = new LocalLlmChatService(new LocalLlmChatLibrary(root), transport);
    const chat = await service.createChat({
      runtimeId: "ollama",
      model: "qwen3"
    });

    await service.sendMessage(chat.id, "Explain the storage policy");
    await waitFor(() => service.getChat(chat.id), (detail) => detail.generationState === "idle");

    const persisted = await new LocalLlmChatService(new LocalLlmChatLibrary(root), transport)
      .getChat(chat.id);
    assert.equal(persisted.runtimeId, "ollama");
    assert.equal(persisted.model, "qwen3");
    assert.deepEqual(
      persisted.messages.map((message) => [message.role, message.text]),
      [
        ["user", "Explain the storage policy"],
        ["assistant", "Local answer"]
      ]
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("starts new local chats in ask mode instead of granting full machine access", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "qwen3" });

    assert.equal(chat.agentMode, "ask");
    assert.equal((await library.getManifest(chat.id)).agentMode, "ask");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("startup removes orphaned Local LLM patch transactions from known workspaces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  const workspacePath = path.join(root, "workspace");
  const orphanPath = path.join(
    workspacePath,
    ".deskcue-data",
    "local-llm-patches",
    "orphaned-transaction"
  );
  try {
    await mkdir(orphanPath, { recursive: true });
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(path.join(root, "chats")),
      { async generate() {} },
      {
        listWorkspaces: () => [{
          ...testWorkspace(),
          path: workspacePath
        }]
      }
    );

    await service.listChats();

    await assert.rejects(access(orphanPath), { code: "ENOENT" });
    await service.close();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("serializes concurrent local chat manifest updates without losing fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "qwen3" });

    await Promise.all([
      library.setModel(chat.id, "qwen3:8b"),
      library.setWorkspace(chat.id, {
        id: "workspace-1",
        name: "DeskCue",
        path: "D:\\work\\DeskCue"
      }),
      library.setAgentMode(chat.id, "auto_workspace")
    ]);

    const manifest = await library.getManifest(chat.id);
    assert.equal(manifest.model, "qwen3:8b");
    assert.equal(manifest.agentMode, "auto_workspace");
    assert.deepEqual(manifest.workspace, {
      id: "workspace-1",
      name: "DeskCue",
      path: "D:\\work\\DeskCue"
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps a fuller original local prompt for the session header than for the chat list", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const prompt = "DeskCue LM Studio E2E. Do not use tools and do not read or modify files. Reply only: DESKCUE_LM_READY_OK";
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate({ onDelta }) { onDelta("OK"); } },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        on: () => undefined,
        publishServerEvent(event) {
          if (event.type === "local.llm.chat.finished") resolveFinished();
        }
      }
    );
    const chat = await service.createChat({ runtimeId: "lm-studio", model: "local-model" });

    await service.sendMessage(chat.id, prompt);
    await withTestTimeout(finished, 10_000, "Timed out waiting for the header-title turn.");
    const detail = await service.getChat(chat.id, {}, "initial");

    assert.match(detail.title, /\.\.\.$/);
    assert.equal(detail.headerTitle, prompt);
    const restartedLibrary = new LocalLlmChatLibrary(root);
    assert.equal((await restartedLibrary.getManifest(chat.id)).headerTitle, prompt);
    assert.equal(await restartedLibrary.getHeaderTitle(chat.id), prompt);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("publishes a terminal notification event for a completed local model turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const events: ServerEvent[] = [];
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate({ onDelta }) { onDelta("Local answer"); } },
      undefined,
      undefined,
      undefined,
      undefined,
      { publishServerEvent: (event) => events.push(event), on: () => undefined }
    );
    const chat = await service.createChat({ runtimeId: "ollama", model: "qwen3" });

    await service.sendMessage(chat.id, "Finish this local prompt");
    await waitFor(
      async () => events.find((event) => event.type === "local.llm.chat.finished"),
      Boolean
    );

    const terminal = events.find((event) => event.type === "local.llm.chat.finished");
    assert.deepEqual(terminal, {
      type: "local.llm.chat.finished",
      payload: {
        answer: "Local answer",
        chatId: chat.id,
        completedAt: terminal?.type === "local.llm.chat.finished" ? terminal.payload.completedAt : undefined,
        error: null,
        model: "qwen3",
        runtimeId: "ollama",
        status: "completed",
        title: chat.title
      }
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("persists an unsent LM Studio prompt across a service restart and clears it only when sent or discarded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const transport: LocalLlmChatTransport = { async generate({ onDelta }) { onDelta("ready"); } };
    const service = new LocalLlmChatService(new LocalLlmChatLibrary(root), transport);
    const chat = await service.createChat({ runtimeId: "lm-studio", model: "local-model" });

    await service.savePendingLmStudioPrompt(chat.id, "Send this after Local Server starts");
    const recovered = await new LocalLlmChatService(new LocalLlmChatLibrary(root), transport).getChat(chat.id);
    assert.deepEqual(recovered.pendingLmStudioPrompt, {
      requestedAt: recovered.pendingLmStudioPrompt?.requestedAt,
      text: "Send this after Local Server starts"
    });
    assert.deepEqual(recovered.messages, []);

    await service.sendMessage(chat.id, recovered.pendingLmStudioPrompt!.text);
    const sent = await waitFor(() => service.getChat(chat.id), (detail) => detail.generationState === "idle");
    assert.equal(sent.pendingLmStudioPrompt, null);

    await service.savePendingLmStudioPrompt(chat.id, "Discard me");
    const discarded = await service.discardPendingLmStudioPrompt(chat.id);
    assert.equal(discarded.pendingLmStudioPrompt, null);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("defers an unavailable LM Studio prompt before creating a user message or a turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    let generateCalls = 0;
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() { generateCalls += 1; } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => "server_off"
    );
    const chat = await service.createChat({ runtimeId: "lm-studio", model: "local-model" });

    const deferred = await service.sendMessage(chat.id, "Keep this prompt until LM Studio is ready");

    assert.deepEqual(deferred.messages, []);
    assert.deepEqual(deferred.pendingLmStudioPrompt, {
      requestedAt: deferred.pendingLmStudioPrompt?.requestedAt,
      reason: "server_off",
      text: "Keep this prompt until LM Studio is ready"
    });
    assert.equal(deferred.generationState, "idle");
    assert.equal(generateCalls, 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reserves a local chat before asynchronous readiness checks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  let releaseReadiness: () => void = () => undefined;
  let markReadinessStarted: () => void = () => undefined;
  const readinessGate = new Promise<void>((resolve) => {
    releaseReadiness = resolve;
  });
  const readinessStarted = new Promise<void>((resolve) => {
    markReadinessStarted = resolve;
  });
  try {
    let generateCalls = 0;
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate({ onDelta }) { generateCalls += 1; onDelta("done"); } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        markReadinessStarted();
        await readinessGate;
        return "ready";
      }
    );
    const chat = await service.createChat({ runtimeId: "lm-studio", model: "local-model" });

    const firstSend = service.sendMessage(chat.id, "first");
    await readinessStarted;
    await assert.rejects(
      service.sendMessage(chat.id, "second"),
      /Another local chat operation is still starting/
    );
    releaseReadiness();
    await firstSend;
    const completed = await waitFor(
      () => service.getChat(chat.id),
      (detail) => detail.generationState === "idle"
    );

    assert.equal(generateCalls, 1);
    assert.deepEqual(completed.messages.map((message) => message.text), ["first", "done"]);
  } finally {
    releaseReadiness();
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupt cancels a message that is still waiting for LM Studio readiness", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  let releaseReadiness: () => void = () => undefined;
  let markReadinessStarted: () => void = () => undefined;
  const readinessGate = new Promise<void>((resolve) => { releaseReadiness = resolve; });
  const readinessStarted = new Promise<void>((resolve) => { markReadinessStarted = resolve; });
  try {
    let generateCalls = 0;
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() { generateCalls += 1; } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        markReadinessStarted();
        await readinessGate;
        return "ready";
      }
    );
    const chat = await service.createChat({ runtimeId: "lm-studio", model: "local-model" });
    const send = service.sendMessage(chat.id, "cancel before start");
    await readinessStarted;
    const interrupted = service.interrupt(chat.id);
    releaseReadiness();

    await Promise.all([send, interrupted]);
    const detail = await service.getChat(chat.id);
    assert.equal(generateCalls, 0);
    assert.deepEqual(detail.messages, []);
    assert.equal(detail.generationState, "idle");
  } finally {
    releaseReadiness();
    await rm(root, { force: true, recursive: true });
  }
});

test("close waits for starting commands and prevents generation after shutdown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  let releaseReadiness: () => void = () => undefined;
  let markReadinessStarted: () => void = () => undefined;
  const readinessGate = new Promise<void>((resolve) => { releaseReadiness = resolve; });
  const readinessStarted = new Promise<void>((resolve) => { markReadinessStarted = resolve; });
  try {
    let generateCalls = 0;
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() { generateCalls += 1; } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        markReadinessStarted();
        await readinessGate;
        return "ready";
      }
    );
    const chat = await service.createChat({ runtimeId: "lm-studio", model: "local-model" });
    const send = service.sendMessage(chat.id, "do not start after close");
    await readinessStarted;
    let closeFinished = false;
    const close = service.close().then(() => { closeFinished = true; });
    await Promise.resolve();
    assert.equal(closeFinished, false);

    releaseReadiness();
    await Promise.all([send, close]);
    assert.equal(generateCalls, 0);
    await assert.rejects(
      service.sendMessage(chat.id, "too late"),
      /Local chat service is shutting down/
    );
  } finally {
    releaseReadiness();
    await rm(root, { force: true, recursive: true });
  }
});

test("persists explicitly exposed Ollama reasoning as one Details event without replaying it as chat text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const transport: LocalLlmChatTransport = {
      async generate({ onDelta, onReasoningDelta }) {
        onReasoningDelta?.("I should calculate before answering.");
        onDelta("42");
      }
    };
    const service = new LocalLlmChatService(new LocalLlmChatLibrary(root), transport);
    const chat = await service.createChat({ runtimeId: "ollama", model: "qwen3:4b" });

    await service.sendMessage(chat.id, "What is six times seven?");
    const detail = await waitFor(() => service.getChat(chat.id), (current) => current.generationState === "idle");

    assert.deepEqual(detail.messages.map((message) => message.text), ["What is six times seven?", "42"]);
    assert.deepEqual(
      detail.events.filter((event) => event.type === "model_reasoning_saved").map((event) => event.summary),
      ["I should calculate before answering."]
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loads local chat history in bounded reverse pages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "qwen3" });
    for (let index = 0; index < 83; index += 1) {
      await library.appendMessage(chat.id, {
        id: `message-${String(index).padStart(3, "0")}`,
        role: index % 2 === 0 ? "user" : "assistant",
        status: "complete",
        text: `message ${index}`,
        timestamp: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString()
      });
    }

    const service = new LocalLlmChatService(library, { async generate() {} });
    const newest = await service.getChat(chat.id);
    assert.equal(newest.messages.length, 80);
    assert.equal(newest.messages[0]?.text, "message 3");
    assert.equal(newest.history.messages.hasMore, true);
    assert.ok(newest.history.messages.nextCursor);

    const older = await service.getChat(chat.id, {
      messages: newest.history.messages.nextCursor
    });
    assert.deepEqual(older.messages.map((message) => message.text), ["message 0", "message 1", "message 2"]);
    assert.equal(older.history.messages.hasMore, false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("uses a compact local event tail for initial and live chat refreshes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "qwen3" });
    await library.completeTurn(chat.id, {
      id: "reasoning-0001",
      messageId: "assistant-0001",
      summary: "r".repeat(128 * 1024),
      timestamp: "2026-08-01T00:00:00.000Z",
      turnId: "turn-0001",
      type: "model_reasoning_saved"
    });
    const service = new LocalLlmChatService(library, { async generate() {} });

    const live = await service.getChat(chat.id, {}, "live");
    const initial = await service.getChat(chat.id, {}, "initial");
    const history = await service.getChat(chat.id);

    assert.ok((live.events[0]?.summary?.length ?? 0) < 2 * 1024);
    assert.match(live.events[0]?.summary ?? "", /Details truncated in the live update/);
    assert.ok((initial.events[0]?.summary?.length ?? 0) < 3 * 1024);
    assert.equal(history.events[0]?.summary?.length, 128 * 1024);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("advances the history cursor when a page reaches its byte budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "qwen3" });
    for (let index = 0; index < 3; index += 1) {
      await library.appendMessage(chat.id, {
        id: `large-message-${index}`,
        role: "assistant",
        status: "complete",
        text: `${index}:${"x".repeat(300 * 1024)}`,
        timestamp: new Date(Date.UTC(2026, 7, 1, 0, 10, index)).toISOString()
      });
    }
    const service = new LocalLlmChatService(library, { async generate() {} });
    const first = await service.getChat(chat.id);
    const second = await service.getChat(chat.id, { messages: first.history.messages.nextCursor });
    const third = await service.getChat(chat.id, { messages: second.history.messages.nextCursor });

    assert.deepEqual(first.messages.map((message) => message.id), ["large-message-2"]);
    assert.deepEqual(second.messages.map((message) => message.id), ["large-message-1"]);
    assert.deepEqual(third.messages.map((message) => message.id), ["large-message-0"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("stores local applied diffs compressed and hydrates them on demand", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "lm-studio", model: "local-model" });
    const diff = `--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-${"before ".repeat(800)}\n+${"after ".repeat(800)}\n`;
    await library.appendChangeSet(chat.id, {
      attribution: "applied_by_deskcue_local_agent",
      changedFiles: ["note.txt"],
      diff,
      id: "change-set-0001",
      timestamp: "2026-08-01T00:00:00.000Z",
      turnId: "turn-1"
    });

    const service = new LocalLlmChatService(library, { async generate() {} });
    const detail = await service.getChat(chat.id);
    assert.equal(detail.changeSets[0]?.diff, "");
    assert.equal(detail.changeSets[0]?.diffStorage, "gzip_sidecar");
    assert.equal((await service.getChangeSetDiff(chat.id, "change-set-0001")).diff, diff);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("archives inactive local chats instead of silently deleting them when the library quota is reached", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root, {
      archiveQuotaBytes: 10_000,
      quotaBytes: 700
    });
    const first = await library.createChat({ runtimeId: "ollama", model: "qwen3" });
    await library.appendMessage(first.id, {
      id: "first-message", role: "user", status: "complete", text: "first ".repeat(55),
      timestamp: "2026-08-01T00:00:00.000Z"
    });
    const staleActivityDate = new Date("2025-01-01T00:00:00.000Z");
    await utimes(path.join(root, first.id), staleActivityDate, staleActivityDate);
    const second = await library.createChat({ runtimeId: "ollama", model: "qwen3" });
    await library.appendMessage(second.id, {
      id: "second-message", role: "user", status: "complete", text: "second ".repeat(55),
      timestamp: "2026-08-01T00:01:00.000Z"
    });

    assert.deepEqual((await library.listChats()).map((chat) => chat.id), [second.id]);
    assert.match(await readFile(path.join(root, "archive-index.jsonl"), "utf8"), new RegExp(first.id));
    await access(path.join(root, "archive", first.id, "chat.json"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("serializes concurrent quota enforcement without archiving the same local chat twice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const setupLibrary = new LocalLlmChatLibrary(root, { quotaBytes: 100_000 });
    const first = await setupLibrary.createChat({ runtimeId: "ollama", model: "qwen3" });
    await setupLibrary.appendMessage(first.id, {
      id: "first-message", role: "user", status: "complete", text: "first ".repeat(55),
      timestamp: "2026-08-01T00:00:00.000Z"
    });
    const second = await setupLibrary.createChat({ runtimeId: "ollama", model: "qwen3" });

    const constrainedLibrary = new LocalLlmChatLibrary(root, {
      archiveQuotaBytes: 10_000,
      quotaBytes: 700
    });
    await Promise.all([
      constrainedLibrary.appendMessage(second.id, {
        id: "second-message-a", role: "user", status: "complete", text: "second a ".repeat(40),
        timestamp: "2026-08-01T00:01:00.000Z"
      }),
      constrainedLibrary.appendMessage(second.id, {
        id: "second-message-b", role: "user", status: "complete", text: "second b ".repeat(40),
        timestamp: "2026-08-01T00:01:01.000Z"
      })
    ]);

    const archiveIndex = await readFile(path.join(root, "archive-index.jsonl"), "utf8");
    assert.equal(archiveIndex.match(new RegExp(first.id, "g"))?.length, 1);
    await access(path.join(root, "archive", first.id, "chat.json"));
    assert.deepEqual((await constrainedLibrary.listChats()).map((chat) => chat.id), [second.id]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bounds the local chat recovery archive and rewrites its index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const setupLibrary = new LocalLlmChatLibrary(root, { quotaBytes: 100_000 });
    const first = await setupLibrary.createChat({ runtimeId: "ollama", model: "qwen3" });
    await setupLibrary.appendMessage(first.id, {
      id: "first-message", role: "user", status: "complete", text: "first ".repeat(55),
      timestamp: "2026-08-01T00:00:00.000Z"
    });
    const second = await setupLibrary.createChat({ runtimeId: "ollama", model: "qwen3" });

    const constrainedLibrary = new LocalLlmChatLibrary(root, {
      archiveQuotaBytes: 1,
      quotaBytes: 700
    });
    await constrainedLibrary.appendMessage(second.id, {
      id: "second-message", role: "user", status: "complete", text: "second ".repeat(55),
      timestamp: "2026-08-01T00:01:00.000Z"
    });

    await assert.rejects(() => access(path.join(root, "archive", first.id, "chat.json")));
    assert.equal(await readFile(path.join(root, "archive-index.jsonl"), "utf8"), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("cleans orphan diff sidecars and rejects a gzip payload that expands past the safe limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "qwen3" });
    const sidecarDirectory = path.join(root, chat.id, "change-diffs");
    await mkdir(sidecarDirectory, { recursive: true });
    await writeFile(path.join(sidecarDirectory, "orphan.patch.gz"), await gzipAsync("orphan"));
    await writeFile(path.join(sidecarDirectory, "orphan.patch.gz.stale.tmp"), "tmp");
    await writeFile(path.join(sidecarDirectory, "journal-change.patch.gz"), await gzipAsync("journal diff"));
    await writeFile(path.join(root, chat.id, "change-set-journal.json"), JSON.stringify({
      changeSet: {
        attribution: "applied_by_deskcue_local_agent", changedFiles: ["journal.txt"], diff: "",
        diffStorage: "gzip_sidecar", id: "journal-change", timestamp: "2026-08-01T00:00:00.000Z", turnId: "turn-journal"
      },
      sidecarFile: "journal-change.patch.gz"
    }));
    await writeFile(path.join(root, chat.id, "change-sets.jsonl"), `${JSON.stringify({
      attribution: "applied_by_deskcue_local_agent", changedFiles: ["note.txt"], diff: "",
      diffStorage: "gzip_sidecar", id: "large-change-01", timestamp: "2026-08-01T00:00:00.000Z", turnId: "turn-1"
    })}\n`);
    await writeFile(
      path.join(sidecarDirectory, "large-change-01.patch.gz"),
      await gzipAsync("x".repeat(MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES + 1))
    );

    const service = new LocalLlmChatService(library, { async generate() {} });
    const recovered = await service.getChat(chat.id);
    assert.equal(recovered.changeSets.some((changeSet) => changeSet.id === "journal-change"), true);
    assert.equal((await service.getChangeSetDiff(chat.id, "journal-change")).diff, "journal diff");
    await assert.rejects(() => access(path.join(sidecarDirectory, "orphan.patch.gz")));
    await assert.rejects(() => access(path.join(sidecarDirectory, "orphan.patch.gz.stale.tmp")));
    await assert.rejects(() => access(path.join(root, chat.id, "change-set-journal.json")));
    await assert.rejects(() => service.getChangeSetDiff(chat.id, "large-change-01"), /cannot be safely decoded/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bounds assistant output and local inference replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const calls: Array<Parameters<LocalLlmChatTransport["generate"]>[0]> = [];
    const service = new LocalLlmChatService(new LocalLlmChatLibrary(root), {
      async generate(input) {
        calls.push(input);
        input.onDelta(calls.length === 1 ? "x".repeat(MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES + 1) : "bounded");
      }
    });
    const chat = await service.createChat({ runtimeId: "ollama", model: "qwen3" });
    await service.sendMessage(chat.id, "overflow");
    await waitForLocalLlmServiceIdle(service);
    const failed = await service.getChat(chat.id);
    assert.equal(failed.generationState, "failed");
    assert.match(failed.generationError ?? "", /512 KiB/);

    const library = new LocalLlmChatLibrary(root);
    for (let index = 0; index < 180; index += 1) {
      await library.appendMessage(chat.id, {
        id: `history-${index}`, role: "user", status: "complete", text: `message ${index}`,
        timestamp: new Date(Date.UTC(2026, 7, 1, 1, 0, index)).toISOString()
      });
    }
    await service.sendMessage(chat.id, "bounded context");
    await waitForLocalLlmServiceIdle(service);
    assert.equal((await service.getChat(chat.id)).generationState, "idle");
    assert.ok(calls[1]!.messages.length <= 161);
    assert.match(calls[1]!.systemPrompt ?? "", /earlier messages were omitted/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("persists a registered workspace snapshot when creating a local chat", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const workspace = testWorkspace();
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [workspace] }
    );

    const chat = await service.createChat({
      runtimeId: "ollama",
      model: "qwen3",
      workspaceId: workspace.id
    });

    assert.deepEqual(chat.workspace, {
      id: workspace.id,
      name: workspace.name,
      path: workspace.path
    });
    const rawManifest = JSON.parse(
      await readFile(path.join(root, chat.id, "chat.json"), "utf8")
    ) as { version: number; workspace: unknown };
    assert.equal(rawManifest.version, 3);
    assert.deepEqual(rawManifest.workspace, chat.workspace);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("returns and refreshes a bounded git snapshot for an attached local chat workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  const workspacePath = path.join(root, "workspace");
  try {
    await createGitWorkspace(workspacePath);
    const workspace = { ...testWorkspace(), path: workspacePath };
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(path.join(root, "chats")),
      { async generate() {} },
      { listWorkspaces: () => [workspace] }
    );
    const chat = await service.createChat({
      model: "qwen3",
      runtimeId: "ollama",
      workspaceId: workspace.id
    });
    await writeFile(path.join(workspacePath, "tracked.txt"), "changed\n", "utf8");

    const initial = await service.getChat(chat.id, {}, "initial");

    assert.equal(initial.git?.isGitRepo, true);
    assert.equal(initial.git?.isDirty, true);
    assert.deepEqual(initial.git?.changedFiles, ["tracked.txt"]);
    assert.match(initial.git?.diff ?? "", /changed/);

    await writeFile(path.join(workspacePath, "after-initial.txt"), "new\n", "utf8");
    const cached = await service.getChat(chat.id, {}, "live");
    assert.deepEqual(cached.git?.changedFiles, ["tracked.txt"]);

    const refreshed = await service.refreshGit(chat.id);
    assert.deepEqual(
      [...(refreshed.git?.changedFiles ?? [])].sort(),
      ["after-initial.txt", "tracked.txt"]
    );
    assert.match(refreshed.git?.diff ?? "", /after-initial\.txt/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("persists preview settings and metadata markers with the local chat", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const service = new LocalLlmChatService(new LocalLlmChatLibrary(root), { async generate() {} });
    const chat = await service.createChat({ runtimeId: "ollama", model: "qwen3" });

    const preview = await service.updatePreviewPort(chat.id, 5173, "deskcue-host");
    assert.deepEqual(preview.preview, {
      active: true,
      artifacts: [],
      networkMode: "deskcue-host",
      port: 5173,
      targetUrl: "http://127.0.0.1:5173"
    });

    const marked = await service.capturePreviewArtifact(chat.id, "mobile");
    assert.equal(marked.preview?.artifacts?.length, 1);
    assert.equal(marked.preview?.artifacts?.[0]?.viewport, "mobile");
    assert.equal(marked.preview?.artifacts?.[0]?.targetUrl, "http://127.0.0.1:5173");

    const restoredService = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} }
    );
    const restored = await restoredService.getChat(chat.id);
    assert.equal(restored.preview?.port, 5173);
    assert.equal(restored.preview?.networkMode, "deskcue-host");
    assert.equal(restored.preview?.artifacts?.length, 1);

    const disabled = await restoredService.updatePreviewPort(chat.id, null);
    assert.equal(disabled.preview?.active, false);
    assert.equal(disabled.preview?.networkMode, "deskcue-host");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects an unknown workspace when creating or attaching a local chat", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [testWorkspace()] }
    );
    await assert.rejects(
      () => service.createChat({ runtimeId: "ollama", model: "qwen3", workspaceId: "missing-workspace" }),
      /Workspace not found/
    );

    const chat = await service.createChat({ runtimeId: "ollama", model: "qwen3" });
    await assert.rejects(() => service.updateWorkspace(chat.id, "missing-workspace"), /Workspace not found/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("approval resumes the same local agent tool turn with the tool result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  const workspacePath = path.join(root, "workspace");
  try {
    await mkdir(workspacePath, { recursive: true });
    await writeFile(path.join(workspacePath, "note.txt"), "before\n", "utf8");
    const workspace = { ...testWorkspace(), path: workspacePath };
    let rounds = 0;
    const agentTransport: LocalLlmAgentTransport = {
      async generate(input) {
        rounds += 1;
        if (rounds === 1) {
          input.onEvent({ type: "assistant_text_delta", text: "Preparing change " });
          input.onEvent({
            type: "tool_call",
            toolCall: {
              id: "call-1",
              name: "apply_unified_diff",
              argumentsText: JSON.stringify({ patch: "--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-before\n+after\n" }),
              arguments: { patch: "--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-before\n+after\n" }
            }
          });
          return;
        }
        const toolResult = input.messages.at(-1);
        assert.equal(toolResult?.role, "tool");
        assert.match(toolResult?.content ?? "", /note\.txt/);
        input.onEvent({ type: "assistant_text_delta", text: "Applied and continued." });
      }
    };
    const probe: LocalLlmToolCapabilityProbe = {
      async probe() {
        return {
          checkedAt: new Date().toISOString(),
          modelSupportsToolCalls: true,
          source: "ollama_model_metadata"
        };
      }
    };
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [workspace] },
      agentTransport,
      probe
    );
    const chat = await service.createChat({ runtimeId: "ollama", model: "tool-model", workspaceId: workspace.id });
    await service.updateAgentMode(chat.id, "ask");
    await service.sendMessage(chat.id, "Change note.txt and tell me when done.");
    const waiting = await waitFor(() => service.getChat(chat.id), (detail) => detail.generationState === "waiting_approval");
    assert.equal(waiting.actionRequests[0]?.status, "pending");
    assert.equal(waiting.pendingAssistantText, "Preparing change ");

    const restarted = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [workspace] },
      agentTransport,
      probe
    );
    const recoveredWaiting = await restarted.getChat(chat.id);
    assert.equal(recoveredWaiting.generationState, "waiting_approval");
    assert.equal(recoveredWaiting.pendingAssistantText, "Preparing change ");
    await restarted.resolveActionRequest(chat.id, waiting.actionRequests[0]!.id, "approve");
    const completed = await waitFor(() => restarted.getChat(chat.id), (detail) => detail.generationState === "idle");
    assert.equal(await readFile(path.join(workspacePath, "note.txt"), "utf8"), "after\n");
    assert.equal(completed.messages.at(-1)?.text, "Preparing change Applied and continued.");
    assert.equal(completed.changeSets[0]?.attribution, "applied_by_deskcue_local_agent");
    assert.equal(completed.changeSets.length, 1);
    assert.equal(rounds, 2);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupt aborts an approved command before the suspended generation resumes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  const workspacePath = path.join(root, "workspace");
  try {
    await mkdir(workspacePath, { recursive: true });
    const workspace = { ...testWorkspace(), path: workspacePath };
    let markCommandStarted!: () => void;
    const commandStarted = new Promise<void>((resolve) => {
      markCommandStarted = resolve;
    });
    class BlockingToolExecutor extends LocalLlmToolExecutor {
      override execute(input: Parameters<LocalLlmToolExecutor["execute"]>[0]) {
        if (input.policy !== "full_access") return super.execute(input);
        markCommandStarted();
        assert.equal(input.request.name, "run_workspace_command");
        return new Promise<never>((_resolve, reject) => {
          const rejectOnAbort = () => reject(input.signal?.reason ?? new Error("Command was aborted."));
          if (input.signal?.aborted) rejectOnAbort();
          else input.signal?.addEventListener("abort", rejectOnAbort, { once: true });
        });
      }
    }
    let rounds = 0;
    const agentTransport: LocalLlmAgentTransport = {
      async generate(input) {
        rounds += 1;
        input.onEvent({
          type: "tool_call",
          toolCall: {
            id: "call-blocking-command",
            name: "run_workspace_command",
            arguments: {
              args: [
                "--version"
              ],
              command: "node"
            },
            argumentsText: JSON.stringify({
              args: [
                "--version"
              ],
              command: "node"
            })
          }
        });
      }
    };
    const probe: LocalLlmToolCapabilityProbe = {
      async probe() {
        return {
          checkedAt: new Date().toISOString(),
          modelSupportsToolCalls: true,
          source: "ollama_model_metadata"
        };
      }
    };
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [workspace] },
      agentTransport,
      probe,
      new BlockingToolExecutor()
    );
    const chat = await service.createChat({
      runtimeId: "ollama",
      model: "tool-model",
      workspaceId: workspace.id
    });
    await service.updateAgentMode(chat.id, "ask");
    await service.sendMessage(chat.id, "Run the blocking test command.");
    await waitForLocalLlmServiceIdle(service);
    const waiting = await service.getChat(chat.id);
    assert.equal(waiting.generationState, "waiting_approval");

    const resolving = service.resolveActionRequest(
      chat.id,
      waiting.actionRequests[0]!.id,
      "approve"
    );
    await commandStarted;
    const interrupted = service.interrupt(chat.id);
    await assert.rejects(resolving);
    await interrupted;

    const detail = await service.getChat(chat.id);
    assert.equal(rounds, 1);
    assert.equal(detail.generationState, "waiting_approval");
    assert.equal(detail.actionRequests[0]?.status, "pending");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("repairs an explicit required tool request instead of saving a model's premature final text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  const workspacePath = path.join(root, "workspace");
  try {
    await mkdir(workspacePath, { recursive: true });
    const workspace = { ...testWorkspace(), path: workspacePath };
    let attempts = 0;
    const agentTransport: LocalLlmAgentTransport = {
      async generate(input) {
        attempts += 1;
        if (attempts === 1) {
          input.onEvent({ type: "assistant_text_delta", text: "PREMATURE_FINAL" });
          return;
        }
        assert.equal(input.messages.at(-1)?.role, "user");
        assert.match(input.messages[0]?.content ?? "", /must be exactly one function call/i);
        input.onEvent({
          type: "tool_call",
          toolCall: {
            id: "call-repair",
            name: "run_workspace_command",
            argumentsText: JSON.stringify({ command: "node", args: ["-e", "process.stdout.write('repaired')"] }),
            arguments: { command: "node", args: ["-e", "process.stdout.write('repaired')"] }
          }
        });
      }
    };
    const probe: LocalLlmToolCapabilityProbe = {
      async probe() {
        return { checkedAt: new Date().toISOString(), modelSupportsToolCalls: true, source: "ollama_model_metadata" };
      }
    };
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [workspace] },
      agentTransport,
      probe
    );
    const chat = await service.createChat({ runtimeId: "ollama", model: "tool-model", workspaceId: workspace.id });
    await service.updateAgentMode(chat.id, "ask");
    await service.sendMessage(chat.id, "Use exactly one native function call: run_workspace_command with command node and args [-e, test].");

    const waiting = await waitFor(() => service.getChat(chat.id), (detail) => detail.generationState === "waiting_approval");
    assert.equal(attempts, 2);
    assert.deepEqual(waiting.messages.map((message) => message.text), ["Use exactly one native function call: run_workspace_command with command node and args [-e, test]."]);
    assert.equal(waiting.actionRequests[0]?.action, "run_workspace_command");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("records only Git-observed workspace changes made by a completed local command", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  const workspacePath = path.join(root, "workspace");
  try {
    await createGitWorkspace(workspacePath);
    await writeFile(path.join(workspacePath, "pre-existing-dirty.txt"), "old workspace dirt\n", "utf8");
    const workspace = { ...testWorkspace(), path: workspacePath };
    let rounds = 0;
    const agentTransport: LocalLlmAgentTransport = {
      async generate(input) {
        rounds += 1;
        if (rounds === 1) {
          input.onEvent({
            type: "tool_call",
            toolCall: {
              id: "command-call-1",
              name: "run_workspace_command",
              argumentsText: JSON.stringify({
                args: ["-e", "require('node:fs').writeFileSync('created-by-command.txt', 'new file\\n')"],
                command: "node"
              }),
              arguments: {
                args: ["-e", "require('node:fs').writeFileSync('created-by-command.txt', 'new file\\n')"],
                command: "node"
              }
            }
          });
          return;
        }
        input.onEvent({ type: "assistant_text_delta", text: "Command completed" });
      }
    };
    const probe: LocalLlmToolCapabilityProbe = {
      async probe() {
        return {
          checkedAt: new Date().toISOString(),
          modelSupportsToolCalls: true,
          source: "ollama_model_metadata"
        };
      }
    };
    let resolveTerminalEvent!: (
      event: Extract<ServerEvent, { type: "local.llm.chat.finished" }>
    ) => void;
    const terminalEvent = new Promise<
      Extract<ServerEvent, { type: "local.llm.chat.finished" }>
    >((resolve) => {
      resolveTerminalEvent = resolve;
    });
    let createdChatId: string | null = null;
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [workspace] },
      agentTransport,
      probe,
      undefined,
      {
        on: () => undefined,
        publishServerEvent(event) {
          if (event.type === "local.llm.chat.finished" && event.payload.chatId === createdChatId) {
            resolveTerminalEvent(event);
          }
        }
      }
    );
    const chat = await service.createChat({ runtimeId: "ollama", model: "tool-model", workspaceId: workspace.id });
    createdChatId = chat.id;
    await service.updateAgentMode(chat.id, "full_access");

    await service.sendMessage(chat.id, "Create a file with the command tool");
    const terminal = await withTestTimeout(
      terminalEvent,
      10_000,
      "Timed out waiting for the local chat completion event."
    );
    assert.equal(terminal.payload.status, "completed", terminal.payload.error ?? undefined);
    const completed = await service.getChat(chat.id);

    assert.equal(rounds, 2);
    assert.equal(completed.generationState, "idle");
    assert.equal(completed.changeSets.length, 1);
    assert.equal(completed.changeSets[0]?.attribution, "workspace_state_observed_between_snapshots");
    assert.deepEqual(completed.changeSets[0]?.changedFiles, ["created-by-command.txt"]);
    const storedDiff = await service.getChangeSetDiff(chat.id, completed.changeSets[0]!.id);
    assert.match(storedDiff.diff, /created-by-command\.txt/);
    assert.doesNotMatch(storedDiff.diff, /pre-existing-dirty/);
    assert.doesNotMatch(completed.changeSets[0]?.changedFiles.join("\n") ?? "", /pre-existing-dirty/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("can detach a workspace without changing the local chat history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const workspace = testWorkspace();
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [workspace] }
    );
    const chat = await service.createChat({
      runtimeId: "lm-studio",
      model: "local-model",
      workspaceId: workspace.id
    });
    await service.sendMessage(chat.id, "Keep this conversation");
    await waitFor(() => service.getChat(chat.id), (detail) => detail.generationState === "idle");

    const detached = await service.updateWorkspace(chat.id, null);
    assert.equal(detached.workspace, null);
    assert.deepEqual(
      detached.messages.map((message) => message.text),
      ["Keep this conversation"]
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reads version 1 local chat manifests as standalone and migrates on the next update", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  const chatId = "legacy-chat-0001";
  try {
    await mkdir(path.join(root, chatId), { recursive: true });
    await writeFile(path.join(root, chatId, "messages.jsonl"), "", "utf8");
    await writeFile(
      path.join(root, chatId, "chat.json"),
      `${JSON.stringify({
        id: chatId,
        title: "Legacy chat",
        runtimeId: "ollama",
        model: "qwen3",
        createdAt: "2026-08-01T07:00:00.000Z",
        updatedAt: "2026-08-01T07:00:00.000Z",
        version: 1
      })}\n`,
      "utf8"
    );
    const workspace = testWorkspace();
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      { async generate() {} },
      { listWorkspaces: () => [workspace] }
    );

    const legacy = await service.getChat(chatId);
    assert.equal(legacy.workspace, null);
    const attached = await service.updateWorkspace(chatId, workspace.id);
    assert.equal(attached.workspace?.id, workspace.id);
    const persisted = JSON.parse(
      await readFile(path.join(root, chatId, "chat.json"), "utf8")
    ) as { version: number; workspace: { id: string } };
    assert.equal(persisted.version, 3);
    assert.equal(persisted.workspace.id, workspace.id);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupt preserves generated local text and allows an immediate replacement prompt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    let generationCount = 0;
    const transport: LocalLlmChatTransport = {
      async generate({ onDelta, signal }) {
        generationCount += 1;
        if (generationCount > 1) {
          onDelta("Replacement answer");
          return;
        }
        onDelta("Partial ");
        onDelta("answer");
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
    };
    const service = new LocalLlmChatService(new LocalLlmChatLibrary(root), transport);
    const chat = await service.createChat({
      runtimeId: "lm-studio",
      model: "local-model"
    });

    await service.sendMessage(chat.id, "Start a long task");
    const running = await waitFor(
      () => service.getChat(chat.id),
      (detail) => detail.generationState === "running" && detail.pendingAssistantText === "Partial answer"
    );
    assert.equal(running.pendingAssistantText, "Partial answer");

    const interrupted = await service.interrupt(chat.id);
    assert.equal(interrupted.generationState, "interrupted");
    assert.deepEqual(
      interrupted.messages.map((message) => [message.role, message.text, message.status]),
      [
        ["user", "Start a long task", "complete"],
        ["assistant", "Partial answer", "interrupted"]
      ]
    );

    await service.sendMessage(chat.id, "Replace the interrupted task");
    const replaced = await waitFor(
      () => service.getChat(chat.id),
      (detail) => detail.generationState === "idle"
    );
    assert.deepEqual(
      replaced.messages.slice(-2).map((message) => [message.role, message.text, message.status]),
      [
        ["user", "Replace the interrupted task", "complete"],
        ["assistant", "Replacement answer", "complete"]
      ]
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("close aborts and drains active generation checkpoints before returning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const service = new LocalLlmChatService(library, {
      async generate({ onDelta, signal }) {
        onDelta("Persist me before shutdown");
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
    });
    const chat = await service.createChat({
      runtimeId: "lm-studio",
      model: "local-model"
    });

    await service.sendMessage(chat.id, "Start a long task");
    await waitFor(
      () => service.getChat(chat.id),
      (detail) => detail.pendingAssistantText === "Persist me before shutdown"
    );

    await service.close();

    const restored = await new LocalLlmChatService(library, { async generate() {} }).getChat(chat.id);
    assert.deepEqual(
      restored.messages.map((message) => [message.role, message.text, message.status]),
      [
        ["user", "Start a long task", "complete"],
        ["assistant", "Persist me before shutdown", "interrupted"]
      ]
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("recovers a checkpointed assistant response after a daemon crash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({
      runtimeId: "lm-studio",
      model: "local-model"
    });
    await library.appendMessage(chat.id, {
      id: "user-1",
      role: "user",
      status: "complete",
      text: "Keep this partial response",
      timestamp: "2026-08-01T07:00:00.000Z"
    });
    await library.checkpointAssistant(chat.id, {
      id: "stream-1",
      role: "assistant",
      status: "interrupted",
      text: "Partial response from before the crash",
      timestamp: "2026-08-01T07:00:01.000Z"
    });

    const service = new LocalLlmChatService(library, {
      async generate() {}
    });
    const recovered = await service.getChat(chat.id);

    assert.deepEqual(
      recovered.messages.map((message) => [message.role, message.text, message.status]),
      [
        ["user", "Keep this partial response", "complete"],
        ["assistant", "Partial response from before the crash", "interrupted_after_restart"]
      ]
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("does not duplicate a recovered checkpoint if restart happens before its cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const library = new LocalLlmChatLibrary(root);
    const chat = await library.createChat({ runtimeId: "ollama", model: "qwen3" });
    const checkpoint = {
      id: "stream-1",
      role: "assistant" as const,
      status: "interrupted" as const,
      text: "Recovered once",
      timestamp: "2026-08-01T07:00:01.000Z"
    };
    await library.checkpointAssistant(chat.id, checkpoint);
    await library.appendMessage(chat.id, {
      ...checkpoint,
      status: "interrupted_after_restart"
    });

    const service = new LocalLlmChatService(library, { async generate() {} });
    const recovered = await service.getChat(chat.id);
    assert.deepEqual(recovered.messages.map((message) => message.text), ["Recovered once"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("continues DeskCue-owned LM Studio chats with the saved native response id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const calls: Array<Parameters<LocalLlmChatTransport["generate"]>[0]> = [];
    const transport: LocalLlmChatTransport = {
      async generate(input) {
        calls.push(input);
        input.onDelta(calls.length === 1 ? "First answer" : "Second answer");
        return { responseId: calls.length === 1 ? "resp_first" : "resp_second" };
      }
    };
    const service = new LocalLlmChatService(new LocalLlmChatLibrary(root), transport);
    const chat = await service.createChat({ runtimeId: "lm-studio", model: "local-model" });

    await service.sendMessage(chat.id, "First question");
    await waitForLocalLlmServiceIdle(service);
    await service.sendMessage(chat.id, "Second question");
    await waitForLocalLlmServiceIdle(service);

    assert.equal((await service.getChat(chat.id)).generationState, "idle");

    assert.deepEqual(
      calls.map(({ useNativeSession, previousResponseId }) => ({ useNativeSession, previousResponseId })),
      [
        { useNativeSession: true, previousResponseId: undefined },
        { useNativeSession: true, previousResponseId: "resp_first" }
      ]
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("falls back from a broken native LM Studio stream instead of reusing stale state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    const calls: Array<Parameters<LocalLlmChatTransport["generate"]>[0]> = [];
    const transport: LocalLlmChatTransport = {
      async generate(input) {
        calls.push(input);
        if (calls.length === 1) {
          input.onDelta("Partial answer");
          throw new Error("connection dropped");
        }
      }
    };
    const service = new LocalLlmChatService(new LocalLlmChatLibrary(root), transport);
    const chat = await service.createChat({ runtimeId: "lm-studio", model: "local-model" });

    await service.sendMessage(chat.id, "First question");
    await waitForLocalLlmServiceIdle(service);
    assert.equal((await service.getChat(chat.id)).generationState, "failed");
    await service.sendMessage(chat.id, "Try again");
    await waitForLocalLlmServiceIdle(service);
    assert.equal((await service.getChat(chat.id)).generationState, "idle");

    assert.equal(calls[0]?.useNativeSession, true);
    assert.equal(calls[1]?.useNativeSession, false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bounds concurrent generations globally without creating a queued phantom turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  try {
    let calls = 0;
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      {
        async generate({ onDelta }) {
          calls += 1;
          if (calls === 1) await firstGate;
          onDelta(`answer-${calls}`);
        }
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        maxConcurrentGenerations: 1,
        queueCapacity: 1
      }
    );
    const first = await service.createChat({ runtimeId: "ollama", model: "model" });
    const second = await service.createChat({ runtimeId: "ollama", model: "model" });
    const overflow = await service.createChat({ runtimeId: "ollama", model: "model" });

    await service.sendMessage(first.id, "first");
    const secondSend = service.sendMessage(second.id, "second");
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(calls, 1);
    const queuedDetail = await service.getChat(second.id);
    assert.equal(queuedDetail.generationState, "idle");
    assert.deepEqual(queuedDetail.messages, []);
    await assert.rejects(
      service.sendMessage(overflow.id, "overflow"),
      /Local runtime generation queue is full/
    );
    assert.deepEqual((await service.getChat(overflow.id)).messages, []);

    releaseFirst();
    await secondSend;
    await waitFor(() => service.getChat(second.id), (detail) => detail.generationState === "idle");
    assert.equal(calls, 2);
  } finally {
    releaseFirst();
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupt cancels a generation queued behind the global limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  try {
    let calls = 0;
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      {
        async generate() {
          calls += 1;
          if (calls === 1) await firstGate;
        }
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        maxConcurrentGenerations: 1,
        queueCapacity: 2
      }
    );
    const first = await service.createChat({ runtimeId: "ollama", model: "model" });
    const second = await service.createChat({ runtimeId: "ollama", model: "model" });

    await service.sendMessage(first.id, "first");
    const secondSend = service.sendMessage(second.id, "second");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await Promise.all([secondSend, service.interrupt(second.id)]);

    assert.equal(calls, 1);
    const detail = await service.getChat(second.id);
    assert.equal(detail.generationState, "idle");
    assert.deepEqual(detail.messages, []);
    releaseFirst();
    await waitFor(() => service.getChat(first.id), (current) => current.generationState === "idle");
  } finally {
    releaseFirst();
    await rm(root, { force: true, recursive: true });
  }
});

test("close cancels queued generations and drains the active slot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskcue-chats-test-"));
  try {
    let calls = 0;
    const service = new LocalLlmChatService(
      new LocalLlmChatLibrary(root),
      {
        async generate({ signal }) {
          calls += 1;
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        maxConcurrentGenerations: 1,
        queueCapacity: 2
      }
    );
    const first = await service.createChat({ runtimeId: "ollama", model: "model" });
    const second = await service.createChat({ runtimeId: "ollama", model: "model" });

    await service.sendMessage(first.id, "first");
    const secondSend = service.sendMessage(second.id, "second");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await Promise.all([secondSend, service.close()]);

    assert.equal(calls, 1);
    const queuedDetail = await service.getChat(second.id);
    assert.equal(queuedDetail.generationState, "idle");
    assert.deepEqual(queuedDetail.messages, []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
