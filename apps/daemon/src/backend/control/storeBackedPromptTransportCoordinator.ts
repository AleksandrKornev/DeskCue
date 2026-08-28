import { claudeCodeAdapter, codexAdapter } from "@deskcue/adapters";
import type { SessionDetail, SessionStatus } from "@deskcue/protocol";
import {
  restartCodexTransport as restartCodexTransportProcess,
  settleCodexSessionAfterReplacementSpawnFailure
} from "#agents/codex/session/codexPromptDelivery";
import { hasCodexActiveWriterConflict } from "#agents/codex/session/codexWriterConflict";
import { SourcePromptStartupError } from "#agents/sourceAgentPromptProcess";
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
import {
  noOpPromptDeliveryJournal,
  StoreBackedPromptDeliveryLifecycle
} from "./storeBackedPromptDeliveryLifecycle.ts";
import type {
  PreparedPromptDelivery,
  StoreBackedPromptTransportCoordinatorOptions
} from "./storeBackedPromptTransportCoordinator.types.ts";
import { createCodexPromptDeliveryCallbacks } from "../callbacks/storeBackedSessionCallbacks.ts";

export type { PromptDeliveryJournal } from "./storeBackedPromptTransportCoordinator.types.ts";
export { noOpPromptDeliveryJournal };

export class StoreBackedPromptTransportCoordinator {
  private readonly deliveryLifecycle: StoreBackedPromptDeliveryLifecycle;
  private readonly sourcePromptTransports: SourcePromptTransportStrategyRegistry;
  private readonly queuedPromptDeliveries = new Map<
    string,
    Extract<PreparedPromptDelivery, { kind: "exact" }>
  >();

  constructor(
    private readonly options: StoreBackedPromptTransportCoordinatorOptions
  ) {
    this.deliveryLifecycle = new StoreBackedPromptDeliveryLifecycle(options);
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
            deliveryRequestedAt: requestedAt,
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
        if (preparedDelivery.kind === "exact") this.queuedPromptDeliveries.set(session.id, preparedDelivery);
        const updatedSession = this.options.getSession(session.id) ?? session;

        this.options.publishSessionUpdate(updatedSession);
        return updatedSession;
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
    return this.deliveryLifecycle.runGuarded(session.id, async () => {
      this.deliveryLifecycle.assertCanStart(session);
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
      const updatedSession = await strategy.start(session, prompt, preparedDelivery.requestedAt, {
        markPromptAccepted: (sessionId) =>
          this.markDeliveryAccepted(sessionId, preparedDelivery),
        markPromptDispatching: (sessionId) =>
          this.markDeliveryDispatching(sessionId, preparedDelivery)
      });

      this.options.publishSessionUpdate(updatedSession);
      return updatedSession;
    } catch (error) {
      const confirmedStartupFailure = error instanceof SourcePromptStartupError;
      const disposition = confirmedStartupFailure
        ? this.markConfirmedStartupFailure(session.id, preparedDelivery)
        : this.deliveryLifecycle.markFailed(session.id, preparedDelivery);
      let cleanupError: unknown;

      if (confirmedStartupFailure) {
        try {
          await this.disposeFailedPromptChild(session.id, error.child);
        } catch (childCleanupError) {
          cleanupError = childCleanupError;
        }

        if (session.adapterId === codexAdapter.id) {
          settleCodexSessionAfterReplacementSpawnFailure(
            {
              stopGitPolling: (sessionId) => this.options.gitPolling.stop(sessionId),
              updateSession: (sessionId, patch) =>
                this.options.updateSession(sessionId, patch)
            },
            session,
            new Date().toISOString()
          );
        }
      }

      await this.deliveryLifecycle.persistRecovery(
        session.id,
        preparedDelivery,
        disposition
      );

      this.options.publishSessionUpdate(this.options.getSession(session.id) ?? session);

      if (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Source prompt startup and failed-child cleanup both failed."
        );
      }

      throw error;
    }
  }

  private markConfirmedStartupFailure(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery
  ): "not_sent" | "outcome_unknown" | null {
    if (preparedDelivery.kind === "exact") {
      const definitelyNotSent =
        this.options.promptDeliveries.markNotSentAfterSynchronousSpawnFailure?.(
          preparedDelivery.deliveryId
        ) ?? this.options.promptDeliveries.markNotSent(preparedDelivery.deliveryId);
      if (definitelyNotSent) return "not_sent";
    }

    return this.deliveryLifecycle.markFailed(sessionId, preparedDelivery);
  }

  private async disposeFailedPromptChild(
    sessionId: string,
    child: RunningChild | undefined
  ) {
    if (!child) return;

    try {
      await this.options.sessionRunner.killChild(sessionId, child, "startup-failure");
    } finally {
      if (this.options.sessionRunner.isCurrentChild(sessionId, child)) {
        this.options.sessionRunner.deleteChild(sessionId);
      }
    }
  }

  async startQueuedCodexPrompt(session: SessionDetail) {
    return this.deliveryLifecycle.runGuarded(
      session.id,
      () => this.startQueuedCodexPromptWithoutGuard(session)
    );
  }

  async cancelQueuedCodexPrompt(session: SessionDetail) {
    return this.deliveryLifecycle.runGuarded(session.id, async () => {
      const currentSession = this.options.getSession(session.id);

      if (currentSession?.replyState.phase !== "queued") return currentSession ?? session;

      this.options.updateSession(session.id, {
        replyState: emptyReplyState()
      });

      this.options.appendLog(session.id, "system", "Queued input cancelled.\n");
      await this.options.persistState();
      this.queuedPromptDeliveries.delete(session.id);
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
      this.queuedPromptDeliveries.delete(session.id);
      return this.options.getSession(session.id) ?? session;
    }

    const currentSession = this.options.getSession(session.id);

    if (
      currentSession?.replyState.phase !== "queued" ||
      currentSession.replyState.promptText !== queuedReplyState.promptText ||
      currentSession.replyState.requestedAt !== queuedReplyState.requestedAt
    ) {
      this.queuedPromptDeliveries.delete(session.id);
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
      const preparedDelivery = this.queuedPromptDeliveries.get(session.id) ?? {
        kind: "queued" as const,
        promptText: queuedReplyState.promptText,
        requestedAt: queuedReplyState.requestedAt
      };

      return await this.restartCodexTransport(
        {
          ...session,
          replyState: sendingReplyState
        },
        {
          prompt: queuedReplyState.promptText,
          reason: "prompt"
        },
        preparedDelivery
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
    } finally {
      this.queuedPromptDeliveries.delete(session.id);
    }
  }

  markCompleted(sessionId: string) {
    this.options.promptDeliveries.markCompleted(sessionId);
  }

  async beginShutdown() {
    await this.deliveryLifecycle.beginShutdown();
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

  private markUncertainPromptOutcome(sessionId: string, session: SessionDetail | null) {
    const outcomeUnknown = this.options.promptDeliveries.markOutcomeUnknownBySession(sessionId);
    const promptText = session?.replyState.promptText?.trim() ?? "";
    const requestedAt = session?.replyState.deliveryRequestedAt ?? session?.replyState.requestedAt;
    const observedPromptAt = session?.replyState.phase === "waiting" &&
      session.replyState.sourcePromptObserved === true
      ? session.replyState.requestedAt
      : null;

    if (!outcomeUnknown || !promptText || !requestedAt) return;

    this.options.updateSession(sessionId, {
      promptRecovery: {
        ...(observedPromptAt ? { observedPromptAt } : {}),
        phase: observedPromptAt ? "checking" : "outcome_unknown",
        promptText,
        requestedAt,
        retryable: false
      }
    });
  }

  private markDeliveryAccepted(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery
  ) {
    this.deliveryLifecycle.markAccepted(sessionId, preparedDelivery);
  }

  private markDeliveryDispatching(
    sessionId: string,
    preparedDelivery: PreparedPromptDelivery
  ) {
    this.deliveryLifecycle.markDispatching(sessionId, preparedDelivery);
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

  recordSessionFinished(
    sessionId: string,
    session: SessionDetail | null,
    status: SessionStatus,
    exitCode: number | null
  ) {
    if (this.deliveryLifecycle.isShuttingDown()) {
      this.options.promptDeliveries.markOutcomeUnknownBySession(sessionId);
      return;
    }

    if (
      session &&
      hasCodexActiveWriterConflict(session, { requestedAt: session.replyState.requestedAt })
    ) {
      this.options.promptDeliveries.markNotSentAfterActiveWriterConflict(sessionId);
      return;
    }

    if (status === "stopped") {
      this.options.promptDeliveries.markInterrupted(sessionId);
      return;
    }

    if (status === "failed" || (exitCode !== null && exitCode !== 0)) {
      this.markUncertainPromptOutcome(sessionId, session);

      return;
    }

    if (session?.sourceSessionId && session.replyState.phase !== "idle") {
      this.markUncertainPromptOutcome(sessionId, session);
      return;
    }

    this.options.promptDeliveries.markCompleted(sessionId);
  }
}
