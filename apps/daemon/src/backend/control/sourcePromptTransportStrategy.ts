import { claudeCodeAdapter, codexAdapter } from "@deskcue/adapters";
import type { SessionDetail } from "@deskcue/protocol";
import { restartClaudePromptTransport as restartClaudePromptTransportProcess } from "#agents/claude/session/claudePromptDelivery";
import { restartCodexTransport as restartCodexTransportProcess } from "#agents/codex/session/codexPromptDelivery";

import type { StoreBackedPromptTransportCoordinatorOptions } from "./storeBackedPromptTransportCoordinator.types.ts";
import { createCodexPromptDeliveryCallbacks } from "../callbacks/storeBackedSessionCallbacks.ts";

export type PromptTransportJournalHooks = {
  markPromptAccepted: (sessionId: string) => void;
  markPromptDispatching: (sessionId: string) => void;
};

type SourcePromptQueuePolicy =
  | {
      kind: "detached_read_only";
      queuedMessage: string;
    }
  | { kind: "never" };

export type SourcePromptTransportStrategy = {
  queuePolicy: SourcePromptQueuePolicy;
  start: (
    session: SessionDetail,
    prompt: string,
    journalHooks: PromptTransportJournalHooks
  ) => Promise<SessionDetail>;
};

export type SourcePromptTransportStrategyRegistry = ReadonlyMap<
  string,
  SourcePromptTransportStrategy
>;

export function createCodexPromptTransportStrategy(
  options: StoreBackedPromptTransportCoordinatorOptions
): SourcePromptTransportStrategy {
  return {
    queuePolicy: { kind: "never" },
    start: (session, prompt, journalHooks) =>
      (options.restartCodexTransportProcess ?? restartCodexTransportProcess)(
        {
          ...createCodexPromptDeliveryCallbacks(options.getCallbackContext()),
          ...journalHooks
        },
        session,
        { prompt, reason: "prompt" }
      )
  };
}

export function createClaudePromptTransportStrategy(
  options: StoreBackedPromptTransportCoordinatorOptions
): SourcePromptTransportStrategy {
  return {
    queuePolicy: { kind: "never" },
    start: (session, prompt, journalHooks) =>
      (options.restartClaudePromptTransportProcess ?? restartClaudePromptTransportProcess)({
        appendStderrLog: (sessionId, text) =>
          options.appendLog(sessionId, "stderr", text),
        appendStdoutLog: (sessionId, text) =>
          options.appendLog(sessionId, "stdout", text),
        appendSystemLog: (sessionId, text, timestamp) =>
          options.appendLog(sessionId, "system", text, timestamp),
        finishSession: (sessionId, status, exitCode) =>
          options.finishSession(sessionId, status, exitCode),
        getChild: (sessionId) => options.sessionRunner.getChild(sessionId),
        getSession: (sessionId) => options.getSession(sessionId),
        getWorkspace: (workspaceId) => options.repository.getWorkspace(workspaceId),
        isCurrentChild: (sessionId, activeChild) =>
          options.sessionRunner.isCurrentChild(sessionId, activeChild),
        ...journalHooks,
        persistState: options.persistState,
        spawnProcess: (input) => options.sessionRunner.spawnProcess(input),
        startGitPolling: (sessionId, workspacePath) =>
          options.gitPolling.start(sessionId, workspacePath),
        stopGitPolling: (sessionId) => options.gitPolling.stop(sessionId),
        updateSession: (sessionId, patch) => options.updateSession(sessionId, patch)
      }, session, prompt)
  };
}

export function createSourcePromptTransportStrategyRegistry(
  options: StoreBackedPromptTransportCoordinatorOptions
): SourcePromptTransportStrategyRegistry {
  return new Map([
    [claudeCodeAdapter.id, createClaudePromptTransportStrategy(options)],
    [codexAdapter.id, createCodexPromptTransportStrategy(options)]
  ]);
}
