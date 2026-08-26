import { randomUUID } from "node:crypto";

import type {
  CreateLocalLlmChatInput,
  LocalLlmChatDetail,
  LocalLlmChatMessage,
  LocalLlmChatSummary,
  PreviewNetworkMode,
  PreviewViewport
} from "@deskcue/protocol";
import { AppError } from "#application/errors";
import type { DaemonEventBus } from "#application/ports";

import { LocalLlmActionApprovalFlow } from "./localLlmActionApprovalFlow.ts";
import { LocalLlmChatCommandScheduler } from "./localLlmChatCommandScheduler.ts";
import type { ReservedLocalLlmChatCommand } from "./localLlmChatCommandScheduler.ts";
import type { LocalLlmActiveTurn } from "./localLlmChatEvents.ts";
import { recoverLocalLlmChatStartup, resolveLocalLlmChatWorkspace } from "./localLlmChatStartup.ts";
import type { LocalLlmChatWorkspaceResolver } from "./localLlmChatStartup.ts";
import { LocalLlmGitSnapshotCache } from "./localLlmGitSnapshotCache.ts";
import { LocalLlmAgentOrchestrator } from "../generation/localLlmAgentOrchestrator.ts";
import {
  HttpLocalLlmAgentTransport,
  HttpLocalLlmToolCapabilityProbe
} from "../generation/localLlmAgentTransport.ts";
import type {
  LocalLlmAgentTransport,
  LocalLlmToolCapabilityProbe
} from "../generation/localLlmAgentTransport.ts";
import { LocalLlmGenerationGate } from "../generation/localLlmGenerationGate.ts";
import { LocalLlmGenerationLifecycle } from "../generation/localLlmGenerationLifecycle.ts";
import { HttpLocalLlmChatTransport } from "../generation/localLlmProviderTransport.ts";
import type { LocalLlmChatTransport } from "../generation/localLlmProviderTransport.ts";
import { LocalLlmStreamLifecycle } from "../generation/localLlmStreamLifecycle.ts";
import { HttpLocalLlmRuntimeAdapterRegistry } from "../generation/transport/localLlmRuntimeAdapterRegistry.ts";
import { parseLmStudioDesktopConversation } from "../providers/lmStudio/lmStudioDesktopImport.ts";
import {
  LocalLlmChatLibrary,
  MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES
} from "../storage/localLlmChatLibrary.ts";
import type {
  LocalLlmChatHistoryPageMode,
  LocalLlmChatHistoryCursors
} from "../storage/localLlmChatLibrary.ts";
import { LocalLlmToolExecutor } from "../tools/localLlmToolExecutor.ts";
export type { LocalLlmChatTransport } from "../generation/localLlmProviderTransport.ts";

export type { LocalLlmChatWorkspaceResolver } from "./localLlmChatStartup.ts";

export type LocalLlmModelReadinessProbe = (model: string) => Promise<"ready" | "server_off" | "model_unloaded">;

export type LocalLlmGenerationCapacityOptions = {
  maxConcurrentGenerations?: number;
  queueCapacity?: number;
};

export class LocalLlmChatService {
  private readonly actionApproval: LocalLlmActionApprovalFlow;
  private readonly commandScheduler = new LocalLlmChatCommandScheduler();
  private closePromise: Promise<void> | null = null;
  private readonly generationGate: LocalLlmGenerationGate;
  private readonly generations: LocalLlmGenerationLifecycle;
  private readonly gitSnapshots = new LocalLlmGitSnapshotCache();
  private readonly recoveryPromise: Promise<void>;
  private readonly streamLifecycle: LocalLlmStreamLifecycle;

  constructor(
    private readonly library: LocalLlmChatLibrary,
    transport?: LocalLlmChatTransport,
    private readonly workspaces?: LocalLlmChatWorkspaceResolver,
    agentTransport?: LocalLlmAgentTransport,
    toolCapabilityProbe?: LocalLlmToolCapabilityProbe,
    toolExecutor = new LocalLlmToolExecutor(),
    events?: DaemonEventBus,
    private readonly lmStudioReadiness?: LocalLlmModelReadinessProbe,
    generationCapacity: LocalLlmGenerationCapacityOptions = {}
  ) {
    const runtimeAdapters = new HttpLocalLlmRuntimeAdapterRegistry();
    const chatTransport = transport ?? new HttpLocalLlmChatTransport(runtimeAdapters);
    const resolvedAgentTransport = agentTransport ?? new HttpLocalLlmAgentTransport(runtimeAdapters);
    const resolvedToolCapabilityProbe = toolCapabilityProbe
      ?? new HttpLocalLlmToolCapabilityProbe(runtimeAdapters);
    this.generationGate = new LocalLlmGenerationGate(
      generationCapacity.maxConcurrentGenerations ?? 2,
      generationCapacity.queueCapacity ?? 16
    );
    this.streamLifecycle = new LocalLlmStreamLifecycle(this.library, events);
    const agentOrchestrator = new LocalLlmAgentOrchestrator(
      this.library,
      resolvedAgentTransport,
      resolvedToolCapabilityProbe,
      toolExecutor,
      this.streamLifecycle,
      events
    );

    this.generations = new LocalLlmGenerationLifecycle(
      this.library,
      chatTransport,
      agentOrchestrator,
      this.streamLifecycle,
      events
    );
    this.actionApproval = new LocalLlmActionApprovalFlow(
      this.library,
      toolExecutor,
      agentOrchestrator,
      this.generations
    );
    this.recoveryPromise = recoverLocalLlmChatStartup(this.library, this.workspaces);
  }

  async listChats() {
    await this.recoveryPromise;
    const chats = await this.library.listChats();

    return chats.map((chat) => this.toSummary(chat));
  }

  hasActiveGenerations() {
    return this.generations.hasAnyActive();
  }

  async createChat(input: CreateLocalLlmChatInput) {
    await this.recoveryPromise;
    if (!input.model.trim()) throw new AppError("invalid_input", "Choose a local model before starting a chat.");

    const workspace = resolveLocalLlmChatWorkspace(this.workspaces, input.workspaceId ?? null);
    const manifest = await this.library.createChat(input);

    if (workspace) await this.library.setWorkspace(manifest.id, workspace);

    return this.toSummary(workspace ? { ...manifest, workspace } : manifest);
  }

  async updateWorkspace(chatId: string, workspaceId: string | null) {
    return this.runReservedChatCommand(chatId, "mutation", async () => {
      await this.recoveryPromise;
      const workspace = resolveLocalLlmChatWorkspace(this.workspaces, workspaceId);

      await this.library.setWorkspace(chatId, workspace);

      this.gitSnapshots.delete(chatId);
      return this.getChat(chatId, {}, "initial");
    });
  }

  async updateModel(chatId: string, model: string) {
    return this.runReservedChatCommand(chatId, "mutation", async () => {
      await this.recoveryPromise;
      const normalizedModel = model.trim();

      if (!normalizedModel) throw new AppError("invalid_input", "Choose a local model before updating this chat.");

      await this.library.setModel(chatId, normalizedModel);
      return this.getChat(chatId);
    });
  }

  async updateAgentMode(chatId: string, agentMode: LocalLlmChatSummary["agentMode"]) {
    return this.runReservedChatCommand(chatId, "mutation", async () => {
      await this.recoveryPromise;
      await this.library.setAgentMode(chatId, agentMode);
      return this.getChat(chatId);
    });
  }

  async updatePreviewPort(
    chatId: string,
    port: number | null,
    networkMode?: PreviewNetworkMode
  ) {
    return this.runReservedChatCommand(chatId, "mutation", async () => {
      await this.recoveryPromise;
      if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        throw new AppError("invalid_input", "Preview port must be an integer between 1 and 65535.");
      }

      await this.library.setPreviewPort(chatId, port, networkMode);
      return this.getChat(chatId);
    });
  }

  async capturePreviewArtifact(chatId: string, viewport: PreviewViewport) {
    return this.runReservedChatCommand(chatId, "mutation", async () => {
      await this.recoveryPromise;
      await this.library.capturePreviewArtifact(chatId, viewport);
      return this.getChat(chatId);
    });
  }

  async resolveActionRequest(chatId: string, actionRequestId: string, decision: "approve" | "reject") {
    return this.runReservedChatCommand(chatId, "generation", async (reservation) => {
      await this.recoveryPromise;
      const releaseGenerationSlot = await this.generationGate.acquire(reservation.signal);

      if (!releaseGenerationSlot) return this.getChat(chatId);

      let generationStarted = false;

      try {
        if (reservation.cancelRequested) return this.getChat(chatId);

        await this.actionApproval.resolve(
          chatId,
          actionRequestId,
          decision,
          releaseGenerationSlot,
          reservation.signal
        );

        generationStarted = true;
        return this.getChat(chatId);
      } finally {
        if (!generationStarted) releaseGenerationSlot();
      }
    });
  }

  async refreshGit(chatId: string) {
    return this.runReservedChatCommand(chatId, "mutation", async () => {
      await this.recoveryPromise;
      const manifest = await this.library.getManifest(chatId);

      await this.gitSnapshots.read(chatId, manifest.workspace, true);

      return this.getChat(chatId);
    });
  }

  async getChat(
    chatId: string,
    cursors: LocalLlmChatHistoryCursors = {},
    historyMode: LocalLlmChatHistoryPageMode = "history"
  ): Promise<LocalLlmChatDetail> {
    await this.recoveryPromise;
    const [manifest, history, headerTitle] = await Promise.all([
      this.library.getManifest(chatId),
      this.library.getChatHistoryPage(chatId, cursors, historyMode),
      this.library.getHeaderTitle(chatId)
    ]);
    const summary = this.toSummary(manifest);
    const git = await this.gitSnapshots.read(
      chatId,
      manifest.workspace,
      historyMode === "initial"
    );

    return {
      ...summary,
      ...history,
      git,
      headerTitle,
      pendingAssistantText: this.generations.getPendingAssistantText(chatId, manifest),
      pendingLmStudioPrompt: manifest.pendingLmStudioPrompt ?? null,
      actionRequests: manifest.actionRequests ?? []
    };
  }

  async getPreviewConfig(chatId: string) {
    await this.recoveryPromise;
    return (await this.library.getManifest(chatId)).preview ?? null;
  }

  async getChangeSetDiff(chatId: string, changeSetId: string) {
    await this.recoveryPromise;
    return {
      changeSetId,
      diff: await this.library.readChangeSetDiff(chatId, changeSetId)
    };
  }

  async importLmStudioDesktopChat(input: { content: string; model: string; sourceFileName: string }) {
    await this.recoveryPromise;
    if (!input.model.trim()) throw new AppError("invalid_input", "Choose a local model before importing a chat.");

    const imported = parseLmStudioDesktopConversation(input.content);

    return this.toSummary(await this.library.createImportedLmStudioChat({
      ...imported,
      model: input.model.trim(),
      sourceFileName: input.sourceFileName
    }));
  }

  async sendMessage(chatId: string, text: string) {
    return this.runReservedChatCommand(chatId, "send", (reservation) =>
      this.sendMessageReserved(chatId, text, reservation)
    );
  }

  private async sendMessageReserved(
    chatId: string,
    text: string,
    reservation: ReservedLocalLlmChatCommand
  ) {
    await this.recoveryPromise;
    const normalizedText = text.trim();

    if (!normalizedText) throw new AppError("invalid_input", "Message cannot be empty.");

    if (Buffer.byteLength(normalizedText, "utf8") > MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES) {
      throw new AppError("invalid_input", "Local chat message exceeds the 512 KiB storage limit.");
    }

    if (this.generations.hasActive(chatId)) {
      throw new AppError("conflict", "This local chat is still generating a response.");
    }

    const [manifest, inferenceContext] = await Promise.all([
      this.library.getManifest(chatId),
      this.library.getInferenceContext(chatId)
    ]);

    if (reservation.cancelRequested) return this.getChat(chatId);

    if ((manifest.actionRequests ?? []).some((action) => action.status === "pending")) {
      throw new AppError("conflict", "Resolve the pending local agent action before sending another message.");
    }

    if (manifest.runtimeId === "lm-studio" && this.lmStudioReadiness) {
      let readiness: Awaited<ReturnType<LocalLlmModelReadinessProbe>>;
      try {
        readiness = await this.lmStudioReadiness(manifest.model);
      } catch {
        // A failed readiness probe must never create a turn that immediately
        // fails against an unavailable local runtime.
        readiness = "model_unloaded";
      }

      if (readiness !== "ready") {
        if (reservation.cancelRequested) return this.getChat(chatId);

        await this.library.savePendingLmStudioPrompt(chatId, {
          requestedAt: new Date().toISOString(),
          reason: readiness,
          text: normalizedText
        });

        this.streamLifecycle.publishChatUpdated(chatId, true);
        return this.getChat(chatId);
      }
    }

    if (reservation.cancelRequested) return this.getChat(chatId);

    const releaseGenerationSlot = await this.generationGate.acquire(reservation.signal);

    if (!releaseGenerationSlot) return this.getChat(chatId);

    let generationStarted = false;

    try {
      if (reservation.cancelRequested) return this.getChat(chatId);

      const userMessage: LocalLlmChatMessage = {
        id: randomUUID(),
        role: "user",
        text: normalizedText,
        timestamp: new Date().toISOString(),
        status: "complete"
      };

      const turn: LocalLlmActiveTurn = {
        assistantMessageId: randomUUID(),
        startedAt: userMessage.timestamp,
        turnId: randomUUID(),
        userMessageId: userMessage.id
      };

      await this.library.beginTurn(chatId, turn);
      await this.library.appendMessage(chatId, userMessage);
      await this.library.clearPendingLmStudioPrompt(chatId);
      this.generations.startGeneration({
        chatId,
        manifest,
        messages: [...inferenceContext.messages, userMessage],
        contextCompacted: inferenceContext.compacted,
        releaseGenerationSlot,
        turn
      });
      generationStarted = true;
      return this.getChat(chatId);
    } finally {
      if (!generationStarted) releaseGenerationSlot();
    }
  }

  async savePendingLmStudioPrompt(chatId: string, text: string) {
    return this.runReservedChatCommand(chatId, "mutation", () =>
      this.savePendingLmStudioPromptReserved(chatId, text)
    );
  }

  private async savePendingLmStudioPromptReserved(chatId: string, text: string) {
    await this.recoveryPromise;
    const normalizedText = text.trim();

    if (!normalizedText) throw new AppError("invalid_input", "Message cannot be empty.");

    if (Buffer.byteLength(normalizedText, "utf8") > MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES) {
      throw new AppError("invalid_input", "Local chat message exceeds the 512 KiB storage limit.");
    }

    const manifest = await this.library.getManifest(chatId);

    if (manifest.runtimeId !== "lm-studio") {
      throw new AppError("invalid_input", "Only LM Studio chats can save a message while Local Server is unavailable.");
    }

    if (this.generations.hasActive(chatId)) {
      throw new AppError("conflict", "This local chat is still generating a response.");
    }

    await this.library.savePendingLmStudioPrompt(chatId, {
      requestedAt: new Date().toISOString(),
      text: normalizedText
    });

    this.streamLifecycle.publishChatUpdated(chatId, true);
    return this.getChat(chatId);
  }

  async discardPendingLmStudioPrompt(chatId: string) {
    return this.runReservedChatCommand(chatId, "mutation", async () => {
      await this.recoveryPromise;
      await this.library.clearPendingLmStudioPrompt(chatId);
      this.streamLifecycle.publishChatUpdated(chatId, true);
      return this.getChat(chatId);
    });
  }

  async interrupt(chatId: string) {
    await this.recoveryPromise;
    await this.commandScheduler.cancelStartingGeneration(chatId);
    await this.generations.interrupt(chatId);
    return this.getChat(chatId);
  }

  private async runReservedChatCommand<T>(
    chatId: string,
    kind: ReservedLocalLlmChatCommand["kind"],
    command: (reservation: ReservedLocalLlmChatCommand) => Promise<T>
  ) {
    return this.commandScheduler.run(chatId, kind, command);
  }

  close() {
    if (this.closePromise) return this.closePromise;

    this.generationGate.close();
    this.gitSnapshots.clear();
    const initialActiveGenerations = this.generations.abortAndSnapshot();
    const reservationPromises = this.commandScheduler.beginClose();

    this.closePromise = (async () => {
      const [recoveryResult] = await Promise.allSettled([
        this.recoveryPromise,
        ...reservationPromises
      ]);
      const activeGenerations = this.generations.abortAndSnapshot(initialActiveGenerations);
      const generationFailures = await this.generations.collectDrainFailures(activeGenerations);
      const failures = [recoveryResult, ...generationFailures].filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );

      if (failures.length > 0) {
        throw new AggregateError(
          failures.map<unknown>((failure) => failure.reason),
          "Local LLM chats failed to drain cleanly."
        );
      }
    })();
    return this.closePromise;
  }

  private toSummary(
    manifest: Awaited<ReturnType<LocalLlmChatLibrary["createChat"]>>
  ): LocalLlmChatSummary {
    return {
      id: manifest.id,
      title: manifest.title,
      runtimeId: manifest.runtimeId,
      model: manifest.model,
      workspace: manifest.workspace,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      ...this.generations.getSummaryState(manifest),
      agentMode: manifest.agentMode,
      toolCapability: manifest.toolCapability,
      preview: manifest.preview
    };
  }

}
