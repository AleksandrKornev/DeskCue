import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import type {
  CreateLocalLlmChatInput,
  LocalLlmChatChangeSet,
  LocalLlmActionRequest,
  LocalLlmAgentMode,
  LocalLlmChatMessage,
  LocalLlmPendingPrompt,
  LocalLlmToolCapability,
  LocalLlmChatWorkspace,
  PreviewNetworkMode,
  PreviewViewport
} from "@deskcue/protocol";
import { AppError } from "#application/errors";

import {
  appendLocalLlmChangeSet,
  readLocalLlmChangeSetDiff,
  readLocalLlmChangeSets
} from "./localLlmChangeSetRepository.ts";
import {
  DEFAULT_LOCAL_LLM_ARCHIVE_RETENTION_MS,
  DEFAULT_LOCAL_LLM_LIBRARY_QUOTA_BYTES,
  LocalLlmChatArchiveLifecycle
} from "./localLlmChatArchiveLifecycle.ts";
import {
  readFirstJsonlMatch,
  readJsonl,
  readLastJsonlMatch,
  writeJsonAtomic
} from "./localLlmChatFileStore.ts";
import {
  readLocalLlmChatHistoryPage,
  readLocalLlmInferenceTail
} from "./localLlmChatHistoryRepository.ts";
import type {
  LocalLlmChatHistoryCursors,
  LocalLlmChatHistoryPage,
  LocalLlmChatHistoryPageMode
} from "./localLlmChatHistoryRepository.ts";
import { LocalLlmChatManifestMutations } from "./localLlmChatManifestMutations.ts";
import { LocalLlmChatManifestRepository } from "./localLlmChatManifestRepository.ts";
import { LocalLlmChatRecovery } from "./localLlmChatRecovery.ts";
import {
  MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES,
  MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES,
  MAX_LOCAL_LLM_CHANGESET_SIDECAR_BYTES,
  MAX_LOCAL_LLM_HISTORY_PAGE_BYTES,
  MAX_LOCAL_LLM_JSONL_RECORD_BYTES
} from "./localLlmChatStorageLimits.ts";
import { emptyLocalLlmPreview, isLocalLlmChatMessage } from "./localLlmChatStorageSchema.ts";
import type { LocalLlmChatManifest } from "./localLlmChatStorageSchema.ts";
import { isLocalLlmChatEvent, isTerminalEvent } from "../chat/localLlmChatEvents.ts";
import type { LocalLlmActiveTurn, LocalLlmChatEvent } from "../chat/localLlmChatEvents.ts";
import type { LocalLlmToolRequest } from "../tools/localLlmToolExecutor.ts";

const PENDING_ASSISTANT_FILE = "pending-assistant.json";
const MANIFEST_MUTATION_GROWTH_RESERVE_BYTES = 16 * 1024;
export { DEFAULT_LOCAL_LLM_LIBRARY_QUOTA_BYTES };
export const DEFAULT_LOCAL_LLM_INFERENCE_MESSAGE_LIMIT = 160;
const MAX_LOCAL_LLM_HEADER_TITLE_CHARS = 512;

export type ImportedLocalLlmChatMessage = Pick<LocalLlmChatMessage, "role" | "text">;

export {
  MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES,
  MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES,
  MAX_LOCAL_LLM_CHANGESET_SIDECAR_BYTES,
  MAX_LOCAL_LLM_HISTORY_PAGE_BYTES,
  MAX_LOCAL_LLM_JSONL_RECORD_BYTES
};
export type { LocalLlmChatHistoryCursors, LocalLlmChatHistoryPage, LocalLlmChatHistoryPageMode };

export type LocalLlmInferenceContext = {
  compacted: boolean;
  messages: LocalLlmChatMessage[];
};

export type LocalLlmChatLibraryOptions = {
  archiveQuotaBytes?: number;
  archiveRetentionMs?: number;
  quotaBytes?: number;
};

function toChatTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "New local chat";
  }
  return normalized.length > 80 ? `${normalized.slice(0, 77).trimEnd()}...` : normalized;
}

function toHeaderTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_LOCAL_LLM_HEADER_TITLE_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_LOCAL_LLM_HEADER_TITLE_CHARS - 3).trimEnd()}...`;
}

export class LocalLlmChatLibrary {
  private readonly archiveLifecycle: LocalLlmChatArchiveLifecycle;
  private readonly headerTitleByChatId = new Map<string, string | null>();
  private readonly manifests: LocalLlmChatManifestRepository;
  private readonly manifestMutations: LocalLlmChatManifestMutations;
  private readonly recovery: LocalLlmChatRecovery;

  constructor(
    private readonly rootPath: string,
    options: LocalLlmChatLibraryOptions = {}
  ) {
    this.manifests = new LocalLlmChatManifestRepository(rootPath);
    this.manifestMutations = new LocalLlmChatManifestMutations(this.manifests);
    const quotaBytes = Math.max(1, options.quotaBytes ?? DEFAULT_LOCAL_LLM_LIBRARY_QUOTA_BYTES);
    this.archiveLifecycle = new LocalLlmChatArchiveLifecycle(rootPath, this.manifests, {
      archiveQuotaBytes: Math.max(1, options.archiveQuotaBytes ?? quotaBytes),
      archiveRetentionMs: Math.max(0, options.archiveRetentionMs ?? DEFAULT_LOCAL_LLM_ARCHIVE_RETENTION_MS),
      quotaBytes
    });
    this.recovery = new LocalLlmChatRecovery(rootPath, this.manifests, {
      appendEvent: (chatId, event) => this.appendEvent(chatId, event),
      appendRecoveredAssistant: (chatId, message) => this.appendMessage(chatId, message),
      hasMessage: async (chatId, messageId) => Boolean(await readLastJsonlMatch(
        path.join(this.getChatPath(chatId), "messages.jsonl"),
        isLocalLlmChatMessage,
        (message) => message.id === messageId
      )),
      hasTerminalEvent: async (chatId, turnId) => Boolean(await readLastJsonlMatch(
        path.join(this.getChatPath(chatId), "events.jsonl"),
        isLocalLlmChatEvent,
        (event) => event.turnId === turnId && isTerminalEvent(event)
      ))
    });
  }

  async listChats() {
    return (await this.manifests.list())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createChat(input: CreateLocalLlmChatInput) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const manifest: LocalLlmChatManifest = {
      id,
      headerTitle: null,
      title: `New ${input.runtimeId === "ollama" ? "Ollama" : "LM Studio"} chat`,
      runtimeId: input.runtimeId,
      model: input.model.trim(),
      agentMode: "ask",
      toolCapability: null,
      preview: emptyLocalLlmPreview(),
      workspace: null,
      createdAt: now,
      updatedAt: now,
      version: 3
    };
    const chatPath = this.getChatPath(id);
    await mkdir(chatPath, { recursive: true });
    await this.manifests.create(manifest);
    await writeFile(path.join(chatPath, "messages.jsonl"), "", "utf8");
    await this.archiveLifecycle.enforceQuota(id);
    return manifest;
  }

  async getChat(chatId: string) {
    const manifest = await this.readManifest(chatId);
    const messages = await this.readMessages(chatId);
    return { manifest, messages };
  }

  async getHeaderTitle(chatId: string) {
    if (this.headerTitleByChatId.has(chatId)) {
      return this.headerTitleByChatId.get(chatId) ?? null;
    }

    const manifest = await this.readManifest(chatId);
    if (manifest.headerTitle !== undefined) {
      this.headerTitleByChatId.set(chatId, manifest.headerTitle);
      return manifest.headerTitle;
    }

    const firstUserMessage = await readFirstJsonlMatch(
      path.join(this.getChatPath(chatId), "messages.jsonl"),
      isLocalLlmChatMessage,
      (message) => message.role === "user"
    );
    const headerTitle = firstUserMessage ? toHeaderTitle(firstUserMessage.text) : null;
    await this.updateManifest(chatId, (current) => ({
      ...current,
      headerTitle: current.headerTitle ?? headerTitle
    }));
    this.headerTitleByChatId.set(chatId, headerTitle);
    return headerTitle;
  }

  async getManifest(chatId: string) {
    return this.readManifest(chatId);
  }

  async getInferenceContext(chatId: string): Promise<LocalLlmInferenceContext> {
    await this.readManifest(chatId);
    const page = await readLocalLlmInferenceTail(
      path.join(this.getChatPath(chatId), "messages.jsonl"),
      DEFAULT_LOCAL_LLM_INFERENCE_MESSAGE_LIMIT
    );
    return { compacted: page.hasMore, messages: page.items };
  }

  async getChatHistoryPage(
    chatId: string,
    cursors: LocalLlmChatHistoryCursors = {},
    mode: LocalLlmChatHistoryPageMode = "history"
  ): Promise<LocalLlmChatHistoryPage> {
    await this.readManifest(chatId);
    return readLocalLlmChatHistoryPage(this.getChatPath(chatId), cursors, mode);
  }

  async createImportedLmStudioChat(input: {
    messages: ImportedLocalLlmChatMessage[];
    model: string;
    sourceFileName: string;
    systemPrompt?: string;
  }) {
    if (input.messages.some((message) => Buffer.byteLength(message.text, "utf8") > MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES)) {
      throw new AppError("invalid_input", "Imported local chat contains a message that exceeds the 512 KiB storage limit.");
    }
    const manifest = await this.createChat({ runtimeId: "lm-studio", model: input.model });
    const importedAt = new Date().toISOString();
    await this.updateManifest(manifest.id, (current) => ({
      ...current,
      origin: {
        importedAt,
        kind: "lm-studio-desktop-import",
        sourceFileName: input.sourceFileName
      },
      systemPrompt: input.systemPrompt?.trim() || undefined,
      title: `Imported ${current.title.replace(/^New /, "")}`
    }));
    for (const message of input.messages) {
      await this.appendMessage(manifest.id, {
        id: randomUUID(),
        role: message.role,
        status: "complete",
        text: message.text,
        timestamp: new Date().toISOString()
      });
    }
    return this.readManifest(manifest.id);
  }

  async appendMessage(chatId: string, message: LocalLlmChatMessage) {
    await this.readManifest(chatId);
    if (Buffer.byteLength(message.text, "utf8") > MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES) {
      throw new AppError("invalid_input", "Local chat message exceeds the 512 KiB storage limit.");
    }
    const serializedMessage = `${JSON.stringify(message)}\n`;
    await appendFile(
      path.join(this.getChatPath(chatId), "messages.jsonl"),
      serializedMessage,
      "utf8"
    );
    const messageHeaderTitle = message.role === "user" ? toHeaderTitle(message.text) : null;
    if (messageHeaderTitle && !this.headerTitleByChatId.get(chatId)) {
      this.headerTitleByChatId.set(chatId, messageHeaderTitle);
    }
    await this.updateManifest(chatId, (manifest) => ({
      ...manifest,
      headerTitle: manifest.headerTitle ?? messageHeaderTitle,
      title:
        manifest.title.startsWith("New ") && message.role === "user"
          ? toChatTitle(message.text)
          : manifest.title,
      updatedAt: message.timestamp
    }));
    await this.archiveLifecycle.enforceQuota(chatId, Buffer.byteLength(serializedMessage, "utf8"));
  }

  async beginTurn(chatId: string, turn: LocalLlmActiveTurn) {
    await this.updateManifest(chatId, (manifest) => ({
      ...manifest,
      activeTurn: turn,
      updatedAt: turn.startedAt
    }));
    await this.appendEvent(chatId, {
      id: randomUUID(),
      turnId: turn.turnId,
      type: "turn_started",
      timestamp: turn.startedAt,
      messageId: turn.userMessageId
    });
  }

  async completeTurn(chatId: string, event: LocalLlmChatEvent) {
    await this.appendEvent(chatId, event);
    if (!isTerminalEvent(event)) {
      return;
    }
    await this.updateManifest(chatId, (manifest) => (
      manifest.activeTurn?.turnId === event.turnId
        ? { ...manifest, activeTurn: undefined, agentContinuation: undefined, updatedAt: event.timestamp }
        : manifest
    ));
  }

  async checkpointAssistant(chatId: string, message: LocalLlmChatMessage) {
    await this.readManifest(chatId);
    await writeJsonAtomic(path.join(this.getChatPath(chatId), PENDING_ASSISTANT_FILE), message);
  }

  async finalizeAssistant(chatId: string, message: LocalLlmChatMessage) {
    await this.appendMessage(chatId, message);
    await this.removePendingAssistant(chatId);
  }

  async setLmStudioSession(chatId: string, responseId: string | null) {
    await this.updateManifest(chatId, (manifest) => ({
      ...manifest,
      lmStudioSession: {
        mode: responseId ? "native_session" : "history_replay",
        responseId
      }
    }));
  }

  async setWorkspace(chatId: string, workspace: LocalLlmChatWorkspace | null) {
    await this.updateManifest(chatId, (manifest) => ({
      ...manifest,
      workspace
    }));
  }

  async setModel(chatId: string, model: string) {
    await this.updateManifest(chatId, (manifest) => ({ ...manifest, model }));
  }

  async savePendingLmStudioPrompt(chatId: string, prompt: LocalLlmPendingPrompt) {
    await this.updateManifest(chatId, (manifest) => ({ ...manifest, pendingLmStudioPrompt: prompt }));
  }

  async clearPendingLmStudioPrompt(chatId: string) {
    await this.updateManifest(chatId, (manifest) => ({ ...manifest, pendingLmStudioPrompt: undefined }));
  }

  async setAgentMode(chatId: string, agentMode: LocalLlmAgentMode) {
    await this.updateManifest(chatId, (manifest) => ({ ...manifest, agentMode }));
  }

  async setToolCapability(chatId: string, toolCapability: LocalLlmToolCapability) {
    await this.updateManifest(chatId, (manifest) => ({ ...manifest, toolCapability }));
  }

  async setPreviewPort(chatId: string, port: number | null, networkMode?: PreviewNetworkMode) {
    await this.manifestMutations.setPreviewPort(chatId, port, networkMode);
  }

  async capturePreviewArtifact(chatId: string, viewport: PreviewViewport) {
    return this.manifestMutations.capturePreviewArtifact(chatId, viewport);
  }

  async upsertActionRequest(chatId: string, actionRequest: LocalLlmActionRequest) {
    await this.manifestMutations.upsertActionRequest(chatId, actionRequest);
  }

  async savePendingToolRequest(chatId: string, actionRequestId: string, request: LocalLlmToolRequest) {
    await this.manifestMutations.savePendingToolRequest(chatId, actionRequestId, request);
  }

  async takePendingToolRequest(chatId: string, actionRequestId: string) {
    return this.manifestMutations.takePendingToolRequest(chatId, actionRequestId);
  }

  async removePendingToolRequest(chatId: string, actionRequestId: string) {
    await this.manifestMutations.removePendingToolRequest(chatId, actionRequestId);
  }

  async saveAgentContinuation(chatId: string, continuation: NonNullable<LocalLlmChatManifest["agentContinuation"]>) {
    await this.manifestMutations.saveAgentContinuation(chatId, continuation);
  }

  /**
   * Keep an approval boundary recoverable in one manifest update. The assistant
   * text precedes the requested tool call and must survive a daemon restart so
   * the resumed response can finalize the original assistant message.
   */
  async savePendingAgentAction(
    chatId: string,
    input: {
      actionRequest: LocalLlmActionRequest;
      continuation: NonNullable<LocalLlmChatManifest["agentContinuation"]>;
      request: LocalLlmToolRequest;
    }
  ) {
    await this.manifestMutations.savePendingAgentAction(chatId, input);
  }

  async readAgentContinuation(chatId: string) {
    return (await this.readManifest(chatId)).agentContinuation ?? null;
  }

  async recoverInterruptedStreams() {
    await this.recovery.recoverInterruptedStreams();
  }

  private async readManifest(chatId: string): Promise<LocalLlmChatManifest> {
    return this.manifests.read(chatId);
  }

  private async readMessages(chatId: string): Promise<LocalLlmChatMessage[]> {
    return readJsonl(path.join(this.getChatPath(chatId), "messages.jsonl"), isLocalLlmChatMessage);
  }

  private async updateManifest(
    chatId: string,
    update: (manifest: LocalLlmChatManifest) => LocalLlmChatManifest
  ) {
    await this.manifests.update(chatId, update);
    await this.archiveLifecycle.enforceQuota(chatId, MANIFEST_MUTATION_GROWTH_RESERVE_BYTES);
  }

  private async appendEvent(chatId: string, event: LocalLlmChatEvent) {
    const serializedEvent = `${JSON.stringify(event)}\n`;
    await appendFile(
      path.join(this.getChatPath(chatId), "events.jsonl"),
      serializedEvent,
      "utf8"
    );
    await this.archiveLifecycle.enforceQuota(chatId, Buffer.byteLength(serializedEvent, "utf8"));
  }

  async readEvents(chatId: string): Promise<LocalLlmChatEvent[]> {
    try {
      const raw = await readFile(path.join(this.getChatPath(chatId), "events.jsonl"), "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            return isLocalLlmChatEvent(parsed) ? [parsed] : [];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  async appendChangeSet(chatId: string, changeSet: LocalLlmChatChangeSet) {
    const storedBytes = await appendLocalLlmChangeSet(this.getChatPath(chatId), changeSet);
    await this.archiveLifecycle.enforceQuota(chatId, storedBytes);
  }

  async readChangeSetDiff(chatId: string, changeSetId: string) {
    return readLocalLlmChangeSetDiff(this.getChatPath(chatId), changeSetId);
  }

  async readChangeSets(chatId: string): Promise<LocalLlmChatChangeSet[]> {
    return readLocalLlmChangeSets(this.getChatPath(chatId));
  }

  private async removePendingAssistant(chatId: string) {
    try {
      await unlink(path.join(this.getChatPath(chatId), PENDING_ASSISTANT_FILE));
    } catch {
      // The first completed response may not have produced a checkpoint yet.
    }
  }

  private getChatPath(chatId: string) {
    return path.join(this.rootPath, chatId);
  }

}
