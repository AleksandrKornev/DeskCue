import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  rm,
  unlink
} from "node:fs/promises";
import path from "node:path";

import type { LocalLlmChatMessage } from "@deskcue/protocol";

import { recoverLocalLlmChangeSetStorage } from "./localLlmChangeSetRepository.ts";
import { mapWithConcurrency } from "./localLlmChatFileStore.ts";
import { LocalLlmChatManifestRepository } from "./localLlmChatManifestRepository.ts";
import { isLocalLlmChatMessage } from "./localLlmChatStorageSchema.ts";
import type { LocalLlmChatManifest } from "./localLlmChatStorageSchema.ts";
import type { LocalLlmChatEvent } from "../chat/localLlmChatEvents.ts";

const CHAT_ID_PATTERN = /^[a-z0-9-]{8,}$/;
const PENDING_ASSISTANT_FILE = "pending-assistant.json";
const LOCAL_LLM_RECOVERY_CONCURRENCY = 4;

export type LocalLlmChatRecoveryPersistence = {
  appendEvent: (chatId: string, event: LocalLlmChatEvent) => Promise<void>;
  appendRecoveredAssistant: (chatId: string, message: LocalLlmChatMessage) => Promise<void>;
  hasMessage: (chatId: string, messageId: string) => Promise<boolean>;
  hasTerminalEvent: (chatId: string, turnId: string) => Promise<boolean>;
};

/** Owns crash recovery as one idempotent pass over every persisted chat. */
export class LocalLlmChatRecovery {
  constructor(
    private readonly rootPath: string,
    private readonly manifests: LocalLlmChatManifestRepository,
    private readonly persistence: LocalLlmChatRecoveryPersistence
  ) {}

  async recoverInterruptedStreams() {
    let entries;
    try {
      entries = await readdir(this.rootPath, { withFileTypes: true });
    } catch {
      return;
    }

    const chatEntries = entries.filter(
      (entry) => entry.isDirectory() && CHAT_ID_PATTERN.test(entry.name)
    );
    await mapWithConcurrency(chatEntries, LOCAL_LLM_RECOVERY_CONCURRENCY, async (entry) => {
      await this.recoverInterruptedStream(entry.name);
      await recoverLocalLlmChangeSetStorage(this.getChatPath(entry.name));
    });
  }

  private async recoverInterruptedStream(chatId: string) {
    await this.removeOrphanTemporaryFiles(chatId);
    const pendingPath = path.join(this.getChatPath(chatId), PENDING_ASSISTANT_FILE);
    try {
      await this.manifests.read(chatId);
      const raw = await readFile(pendingPath, "utf8");
      const message = JSON.parse(raw) as unknown;
      if (!isLocalLlmChatMessage(message) || message.role !== "assistant" || !message.text.trim()) {
        await unlink(pendingPath);
        return;
      }
      if (!(await this.persistence.hasMessage(chatId, message.id))) {
        await this.persistence.appendRecoveredAssistant(chatId, {
          ...message,
          status: "interrupted_after_restart",
          timestamp: new Date().toISOString()
        });
      }
      await unlink(pendingPath);
    } catch {
      // No checkpoint is the normal state for an idle chat.
    }
    await this.recoverActiveTurn(chatId);
  }

  private async recoverActiveTurn(chatId: string) {
    let manifest: LocalLlmChatManifest;
    try {
      manifest = await this.manifests.read(chatId);
    } catch {
      return;
    }
    const activeTurn = manifest.activeTurn;
    if (!activeTurn) return;
    if ((manifest.actionRequests ?? []).some(
      (action) => action.turnId === activeTurn.turnId && action.status === "pending"
    )) {
      return;
    }
    const terminalAlreadyRecorded = await this.persistence.hasTerminalEvent(chatId, activeTurn.turnId);
    if (!terminalAlreadyRecorded) {
      await this.persistence.appendEvent(chatId, {
        id: randomUUID(),
        turnId: activeTurn.turnId,
        type: "turn_interrupted_after_restart",
        timestamp: new Date().toISOString()
      });
    }
    await this.manifests.update(chatId, (current) => (
      current.activeTurn?.turnId === activeTurn.turnId
        ? { ...current, activeTurn: undefined, agentContinuation: undefined, updatedAt: new Date().toISOString() }
        : current
    ));
  }

  private async removeOrphanTemporaryFiles(chatId: string) {
    let entries;
    try {
      entries = await readdir(this.getChatPath(chatId), { withFileTypes: true });
    } catch {
      return;
    }
    await mapWithConcurrency(entries, LOCAL_LLM_RECOVERY_CONCURRENCY, async (entry) => {
      if (entry.isFile() && entry.name.endsWith(".tmp")) {
        await rm(path.join(this.getChatPath(chatId), entry.name), { force: true });
      }
    });
  }

  private getChatPath(chatId: string) {
    return path.join(this.rootPath, chatId);
  }
}
