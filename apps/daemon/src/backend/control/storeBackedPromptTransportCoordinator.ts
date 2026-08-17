import { claudeCodeAdapter, codexAdapter } from "@deskcue/adapters";
import type { SessionDetail, SessionStatus } from "@deskcue/protocol";
import { restartCodexTransport as restartCodexTransportProcess } from "#agents/codex/session/codexPromptDelivery";
import { AppError } from "#application/errors";
import { emptyReplyState } from "#sessions/model/sessionDefaults";
import type { RunningChild } from "#sessions/process/sessionProcess";

import {
  createSourcePromptTransportStrategyRegistry
} from "./sourcePromptTransportStrategy.ts";
import type {
  SourcePromptTransportStrategy,
  SourcePromptTransportStrategyRegistry
} from "./sourcePromptTransportStrategy.ts";
import type {
  PreparedPromptDelivery,
  PromptDeliveryJournal,
  StoreBackedPromptTransportCoordinatorOptions
} from "./storeBackedPromptTransportCoordinator.types.ts";
import { createCodexPromptDeliveryCallbacks } from "../callbacks/storeBackedSessionCallbacks.ts";

export type { PromptDeliveryJournal } from "./storeBackedPromptTransportCoordinator.types.ts";

export const noOpPromptDeliveryJournal: PromptDeliveryJournal = {
  markAccepted: () => true,
  markAcceptedBySession: () => true,
  markActiveOutcomeUnknownForShutdown: () => 0,
  markCompleted: () => {},
  markDispatching: () => true,
  markDispatchingBySession: () => true,
  markInterrupted: () => {},
  markNotSent: () => true,
  markNotSentAfterSynchronousSpawnFailure: () => true,
  markNotSentBySession: () => true,
  markObservedBySession: () => true,
  markOutcomeUnknown: () => true,
  markOutcomeUnknownBySession: () => true,
  prepare: () => ""
};

export class StoreBackedPromptTransportCoordinator {
  private readonly sourcePromptTransports: SourcePromptTransportStrategyRegistry;
  private readonly inFlightPromptSessionIds = new Set<string>();
  private readonly shutdownDrainWaiters: Array<() => void> = [];
  private shuttingDown = false;

  constructor(
    private readonly options: StoreBackedPromptTransportCoordinatorOptions
  ) {
    this.sourcePromptTransports = createSourcePromptTransportStrategyRegistry(options);
  }

  supportsSourceInput(adapterId: string) {
    return this.sourcePromptTransports.has(adapterId);
  }

  async sendSourceInput(
    session: SessionDetail,
    child: RunningChild | undefined,
    input: string
  ): Promise<SessionDetail> {
    return this.sendSourcePrompt(
      session,
      child,
      input,
      this.requireSourcePromptTransport(session.adapterId)
    );
  }

  async restartCodexTransport(
    session: SessionDetail,
    options: {
      prompt?: string;
      reason: "prompt" | "interrupt";
    },
    preparedDelivery?: PreparedPromptDelivery
  ): Promise<SessionDetail> {
    if (options.reason === "interrupt") this.options.promptDeliveries.markInterrupted(session.id);
    if (options.reason === "prompt" && !preparedDelivery) {
      return this.startNewSourcePrompt(
        session,
        options.prompt,
        this.requireSourcePromptTransport(codexAdapter.id)
      );
    }
    if (options.reason === "prompt" && preparedDelivery) {
      return this.startPreparedSourcePrompt(
        session,
        this.requirePrompt(options.prompt),
        preparedDelivery,
        this.requireSourcePromptTransport(codexAdapter.id)
      );
    }
    return (this.options.restartCodexTransportProcess ?? restartCodexTransportProcess)(
      createCodexPromptDeliveryCallbacks(this.options.getCallbackContext()),
      session,
      options
    );
  }

  async restartClaudePromptTransport(
    session: SessionDetail,
    input: string,
    preparedDelivery?: PreparedPromptDelivery
  ): Promise<SessionDetail> {
    if (!preparedDelivery) {
      return this.startNewSourcePrompt(
        session,
        input,
        this.requireSourcePromptTransport(claudeCodeAdapter.id)
      );
    }
    return this.startPreparedSourcePrompt(
      session,
      this.requirePrompt(input),
      preparedDelivery,
      this.requireSourcePromptTransport(claudeCodeAdapter.id)
    );
  }

  private async sendSourcePrompt(
    session: SessionDetail,
    child: RunningChild | undefined,
    input: string | undefined,
    strategy: SourcePromptTransportStrategy
  ): Promise<SessionDetail> {
    return this.withPreparedSourcePrompt(session, input, async (prompt, preparedDelivery) => {
      const { requestedAt } = preparedDelivery;
      if (
        strategy.queuePolicy.kind === "detached_read_only" &&
        !child &&
        session.status === "read_only" &&
        session.sourceSessionId
      ) {
        this.options.updateSession(session.id, {
          replyState: {
            phase: "queued",
            promptText: prompt,
            requestedAt
          }
        });
        this.options.appendLog(
          session.id,
          "system",
          strategy.queuePolicy.queuedMessage,
          requestedAt
        );
        await this.options.persistState();
        return this.options.getSession(session.id) ?? session;
      }

      return this.startPreparedSourcePrompt(session, prompt, preparedDelivery, strategy);
    });
  }

  private async startNewSourcePrompt(
    session: SessionDetail,
    input: string | undefined,
    strategy: SourcePromptTransportStrategy
  ): Promise<SessionDetail> {
    return this.withPreparedSourcePrompt(
      session,
      input,
      (prompt, preparedDelivery) =>
        this.startPreparedSourcePrompt(session, prompt, preparedDelivery, strategy)
    );
  }

  private async withPreparedSourcePrompt(
    session: SessionDetail,
    input: string | undefined,
    run: (prompt: string, delivery: PreparedPromptDelivery) => Promise<SessionDetail>
  ): Promise<SessionDetail> {
    return this.withPromptDeliveryGuard(session.id, async () => {
      this.assertPromptCanStart(session);
      const prompt = this.requirePrompt(input);
      const requestedAt = new Date().toISOString();
      const deliveryId = this.options.promptDeliveries.prepare(session, prompt, requestedAt);
      return run(prompt, {
        deliveryId,
        kind: "exact",
        promptText: prompt,
        requestedAt
      });
    });
  }

  private async startPreparedSourcePrompt(
    session: SessionDetail,
    prompt: string,
    preparedDelivery: PreparedPromptDelivery,
    strategy: SourcePromptTransportStrategy
  ): Promise<SessionDetail> {
    try {
      return await strategy.start(session, prompt, {
        markPromptAccepted: (sessionId) =>
          this.markDeliveryAccepted(sessionId, preparedDelivery),
        markPromptDispatching: (sessionId) =>
          this.markDeliveryDispatching(sessionId, preparedDelivery)
      });
    } catch (error) {
      const disposition = this.markFailedDelivery(session.id, preparedDelivery);
      await this.persistFailedDeliveryRecovery(session.id, preparedDelivery, disposition);
      throw error;
    }
  }

  async startQueuedCodexPrompt(session: SessionDetail) {
    return this.withPromptDeliveryGuard(
      session.id,
      () => this.startQueuedCodexPromptWithoutGuard(session)
    );
  }

  async cancelQueuedCodexPrompt(session: SessionDetail) {
    return this.withPromptDeliveryGuard(session.id, async () => {
      const currentSession = this.options.getSession(session.id);
      if (currentSession?.replyState.phase !== "queued") return currentSession ?? session;

      this.options.updateSession(session.id, {
        replyState: emptyReplyState()
      });
      this.options.appendLog(session.id, "system", "Queued input cancelled.\n");
      await this.options.persistState();
      this.options.promptDeliveries.markInterrupted(session.id);
      return this.options.getSession(session.id) ?? session;
    });
  }

  private async startQueuedCodexPromptWithoutGuard(session: SessionDetail) {
    const queuedReplyState = session.replyState;
    if (
      queuedReplyState.phase !== "queued" ||
      !queuedReplyState.promptText ||
      !queuedReplyState.requestedAt
    ) {
      return this.options.getSession(session.id) ?? session;
    }

    const currentSession = this.options.getSession(session.id);
    if (
      currentSession?.replyState.phase !== "queued" ||
      currentSession.replyState.promptText !== queuedReplyState.promptText ||
      currentSession.replyState.requestedAt !== queuedReplyState.requestedAt
    ) {
      return currentSession ?? session;
    }

    const sendingReplyState = {
      ...queuedReplyState,
      phase: "sending" as const
    };
    this.options.updateSession(session.id, {
      replyState: sendingReplyState
    });

    try {
      return await this.restartCodexTransport(
        {
          ...session,
          replyState: sendingReplyState
        },
        {
          prompt: queuedReplyState.promptText,
          reason: "prompt"
        },
        {
          kind: "queued",
          promptText: queuedReplyState.promptText,
          requestedAt: queuedReplyState.requestedAt
        }
      );
    } catch (error) {
      const latestSession = this.options.getSession(session.id);
      if (
        latestSession?.replyState.phase === "sending" &&
        latestSession.replyState.promptText === queuedReplyState.promptText
      ) {
        this.options.updateSession(session.id, {
          replyState: emptyReplyState()
        });
        this.options.appendLog(
          session.id,
          "system",
          "Queued input could not restart the Codex transport and was cancelled. Send the prompt again after the source chat is ready.\n"
        );
        await this.options.persistState();
      }
      throw error;
    }
  }

  markCompleted(sessionId: string) {
    this.options.promptDeliveries.markCompleted(sessionId);
  }

  async beginShutdown() {
    this.shuttingDown = true;
    this.options.promptDeliveries.markActiveOutcomeUnknownForShutdown();
    if (this.inFlightPromptSessionIds.size > 0) {
      await new Promise<void>((resolve) => {
        this.shutdownDrainWaiters.push(resolve);
      });
    }
  }

  markOutcomeUnknown(sessionId: string) {
    this.options.promptDeliveries.markOutcomeUnknownBySession(sessionId);
  }

  markInterrupted(sessionId: string) {
    this.options.promptDeliveries.markInterrupted(sessionId);
  }

  markPromptObserved(sessionId: string) {
    this.options.promptDeliveries.markObservedBySession(sessionId);
  }

  private markFailedDelivery(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery
  ): "not_sent" | "outcome_unknown" | null {
    const definitelyNotSent = preparedDelivery.kind === "exact"
      ? this.options.promptDeliveries.markNotSent(preparedDelivery.deliveryId)
      : this.options.promptDeliveries.markNotSentBySession(sessionId);
    if (definitelyNotSent) return "not_sent";
    if (preparedDelivery.kind === "exact") {
      return this.options.promptDeliveries.markOutcomeUnknown(preparedDelivery.deliveryId)
        ? "outcome_unknown"
        : null;
    }
    return this.options.promptDeliveries.markOutcomeUnknownBySession(sessionId)
      ? "outcome_unknown"
      : null;
  }

  private markDeliveryAccepted(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery
  ) {
    const transitioned = preparedDelivery.kind === "exact"
      ? this.options.promptDeliveries.markAccepted(preparedDelivery.deliveryId)
      : this.options.promptDeliveries.markAcceptedBySession(sessionId);
    if (!transitioned) {
      if (preparedDelivery.kind === "exact") {
        this.options.promptDeliveries.markOutcomeUnknown(preparedDelivery.deliveryId);
      } else {
        this.options.promptDeliveries.markOutcomeUnknownBySession(sessionId);
      }
      this.options.updateSession(sessionId, {
        promptRecovery: {
          phase: "outcome_unknown",
          promptText: preparedDelivery.promptText,
          requestedAt: preparedDelivery.requestedAt,
          retryable: false
        }
      });
      return;
    }
    this.options.updateSession(sessionId, { promptRecovery: null });
  }

  private markDeliveryDispatching(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery
  ) {
    const transitioned = preparedDelivery.kind === "exact"
      ? this.options.promptDeliveries.markDispatching(preparedDelivery.deliveryId)
      : this.options.promptDeliveries.markDispatchingBySession(sessionId);
    if (!transitioned) throw new Error("Prompt delivery journal was not prepared before dispatch.");
  }

  private assertPromptCanStart(session: SessionDetail) {
    if (this.shuttingDown) {
      throw new AppError(
        "not_accepting_input",
        "DeskCue is shutting down and cannot start another prompt."
      );
    }
    if (session.promptRecovery && !session.promptRecovery.retryable) {
      throw new AppError(
        "not_accepting_input",
        "The previous prompt delivery outcome is still unknown."
      );
    }
    if (session.replyState.phase !== "idle") {
      throw new AppError(
        "not_accepting_input",
        "Session is already handling a prompt."
      );
    }
  }

  private requirePrompt(input: string | undefined) {
    const prompt = input?.trim() ?? "";
    if (!prompt) throw new AppError("invalid_input", "Prompt is empty.");
    return prompt;
  }

  private requireSourcePromptTransport(adapterId: string) {
    const strategy = this.sourcePromptTransports.get(adapterId);
    if (!strategy) {
      throw new AppError(
        "not_accepting_input",
        `Source prompt transport is unavailable for adapter ${adapterId}.`
      );
    }
    return strategy;
  }

  private async persistFailedDeliveryRecovery(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery,
    disposition: "not_sent" | "outcome_unknown" | null
  ) {
    if (!disposition) return;
    const currentSession = this.options.getSession(sessionId);
    if (disposition === "not_sent" && currentSession?.promptRecovery) return;
    this.options.updateSession(sessionId, {
      promptRecovery: {
        phase: disposition,
        promptText: preparedDelivery.promptText,
        requestedAt: preparedDelivery.requestedAt,
        retryable: disposition === "not_sent"
      }
    });
    await this.options.persistState();
  }

  private async withPromptDeliveryGuard<T>(
    sessionId: string,
    run: () => Promise<T>
  ): Promise<T> {
    if (this.inFlightPromptSessionIds.has(sessionId)) {
      throw new AppError(
        "not_accepting_input",
        "Session is already handling a prompt."
      );
    }
    this.inFlightPromptSessionIds.add(sessionId);
    try {
      return await run();
    } finally {
      this.inFlightPromptSessionIds.delete(sessionId);
      if (this.inFlightPromptSessionIds.size === 0) {
        for (const resolve of this.shutdownDrainWaiters.splice(0)) {
          resolve();
        }
      }
    }
  }

  recordSessionFinished(
    sessionId: string,
    session: SessionDetail | null,
    status: SessionStatus,
    exitCode: number | null
  ) {
    if (this.shuttingDown) {
      this.options.promptDeliveries.markOutcomeUnknownBySession(sessionId);
      return;
    }
    if (status === "stopped") {
      this.options.promptDeliveries.markInterrupted(sessionId);
      return;
    }
    if (status === "failed" || (exitCode !== null && exitCode !== 0)) {
      this.options.promptDeliveries.markInterrupted(sessionId);
      return;
    }

    if (
      status === "read_only" &&
      session?.adapterId === "claude-code" &&
      session.replyState.phase === "sending"
    ) {
      return;
    }

    this.options.promptDeliveries.markCompleted(sessionId);
  }
}
