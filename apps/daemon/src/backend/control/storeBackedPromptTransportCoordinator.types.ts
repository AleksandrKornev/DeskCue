import type { SessionDetail, SessionLogLine, SessionStatus } from "@deskcue/protocol";
import type { restartClaudePromptTransport } from "#agents/claude/session/claudePromptDelivery";
import type { restartCodexTransport } from "#agents/codex/session/codexPromptDelivery";
import type { SessionGitPolling } from "#sessions/git/sessionGitPolling";
import type { SessionRunner } from "#sessions/process/sessionRunner";
import type { SessionRepository } from "#sessions/state/sessionRepository";

import type { StoreBackedSessionCallbackContext } from "../callbacks/storeBackedSessionCallbacks.ts";

export type PromptDeliveryJournal = {
  markAccepted: (deliveryId: string) => boolean;
  markAcceptedBySession: (sessionId: string) => boolean;
  markActiveOutcomeUnknownForShutdown: () => number;
  markCompleted: (sessionId: string) => void;
  markDispatching: (deliveryId: string) => boolean;
  markDispatchingBySession: (sessionId: string) => boolean;
  markInterrupted: (sessionId: string) => void;
  markNotSent: (deliveryId: string) => boolean;
  markNotSentAfterActiveWriterConflict: (sessionId: string) => boolean;
  markNotSentAfterSynchronousSpawnFailure?: (deliveryId: string) => boolean;
  markNotSentBySession: (sessionId: string) => boolean;
  markObservedBySession: (sessionId: string) => boolean;
  markOutcomeUnknown: (deliveryId: string) => boolean;
  markOutcomeUnknownBySession: (sessionId: string) => boolean;
  prepare: (
    session: Pick<SessionDetail, "adapterId" | "id" | "sourceSessionId">,
    promptText: string,
    requestedAt?: string
  ) => string;
};

export type StoreBackedPromptTransportCoordinatorOptions = {
  appendLog: (
    sessionId: string,
    stream: SessionLogLine["stream"],
    text: string,
    timestamp?: string
  ) => void;
  finishSession: (
    sessionId: string,
    status: SessionStatus,
    exitCode: number | null
  ) => void;
  getCallbackContext: () => StoreBackedSessionCallbackContext;
  getSession: (sessionId: string) => SessionDetail | null;
  gitPolling: SessionGitPolling;
  persistState: () => Promise<void>;
  promptDeliveries: PromptDeliveryJournal;
  publishSessionUpdate: (session: SessionDetail) => void;
  repository: SessionRepository;
  restartClaudePromptTransportProcess?: typeof restartClaudePromptTransport;
  restartCodexTransportProcess?: typeof restartCodexTransport;
  sessionRunner: SessionRunner;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

export type PreparedPromptDelivery =
  | {
      deliveryId: string;
      kind: "exact";
      promptText: string;
      requestedAt: string;
    }
  | { kind: "queued"; promptText: string; requestedAt: string };
