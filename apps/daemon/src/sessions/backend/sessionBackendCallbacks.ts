import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import type { RunningChild } from "#sessions/process/sessionProcess";

export type SessionLookupCallbackInput = {
  getChild: (sessionId: string) => RunningChild | undefined;
  getPublicSession: (sessionId: string) => SessionDetail | null;
  getSession: (sessionId: string) => SessionDetail | null;
  getWorkspace: (workspaceId: string) => WorkspaceSummary | null;
  isCurrentChild: (sessionId: string, child: RunningChild) => boolean;
};

export function createSessionLookupCallbacks(input: SessionLookupCallbackInput) {
  return {
    getChild: input.getChild,
    getPublicSession: input.getPublicSession,
    getSession: input.getSession,
    getWorkspace: input.getWorkspace,
    isCurrentChild: input.isCurrentChild
  };
}

export type SessionRunnerCallbackInput = {
  deleteChild: (sessionId: string) => void;
  killChild: (
    sessionId: string,
    child: RunningChild | undefined,
    reason: string
  ) => Promise<void>;
  spawnProcess: (input: {
    command: string;
    cwd: string;
    env: Record<string, string | undefined>;
    sessionId: string;
    spawnSpec?: {
      file: string;
      args: string[];
    };
  }) => RunningChild;
};

export function createSessionRunnerCallbacks(input: SessionRunnerCallbackInput) {
  return {
    deleteChild: input.deleteChild,
    killChild: input.killChild,
    spawnProcess: input.spawnProcess
  };
}

export type SessionStateCallbackInput = {
  persistState: () => Promise<void>;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

export function createSessionStateCallbacks(input: SessionStateCallbackInput) {
  return {
    persistState: input.persistState,
    updateSession: input.updateSession
  };
}
