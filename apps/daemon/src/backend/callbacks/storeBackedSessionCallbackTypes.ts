import type {
  AgentSessionSummary,
  CodexSessionDetail,
  CodexSessionSummary,
  GitSnapshot,
  ServerEvent,
  SessionDetail,
  SessionLogLine,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { SessionGitPolling } from "#sessions/git/sessionGitPolling";
import type { RunningChild, SessionSpawnSpec } from "#sessions/process/sessionProcess";
import type { SessionRunner } from "#sessions/process/sessionRunner";
import type { SessionRepository } from "#sessions/state/sessionRepository";

export type StoreBackedSessionLaunchInput = {
  adapterId: string;
  argvInput?: string;
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
  initialInput?: string;
  sourceSessionId: string | null;
  spawnSpec?: SessionSpawnSpec;
  workspace: WorkspaceSummary;
};

export type RestartCodexTransportOptions = {
  prompt?: string;
  reason: "prompt" | "interrupt";
};

export type StoreBackedSessionCallbackContext = {
  appendLog: (
    sessionId: string,
    stream: SessionLogLine["stream"],
    text: string,
    timestamp?: string
  ) => void;
  createReadOnlyCodexSession: (
    codexSession: CodexSessionSummary | CodexSessionDetail,
    reason: string
  ) => Promise<SessionDetail>;
  createReadOnlyClaudeSession: (
    agentSession: AgentSessionSummary,
    options: { observeOnly?: boolean; reason: string }
  ) => Promise<SessionDetail>;
  createWorkspace: (workspacePath: string) => Promise<WorkspaceSummary>;
  detachAttachedSession: (
    sessionId: string,
    options: { reason: string }
  ) => Promise<void>;
  emitServerEvent: (event: ServerEvent) => void;
  findReadOnlyAttachedSession: (
    sourceSessionId: string,
    adapterId?: string
  ) => SessionDetail | null;
  findReusableAttachedSession: (
    sourceSessionId: string,
    adapterId?: string
  ) => SessionDetail | null;
  finishSession: (
    sessionId: string,
    status: SessionStatus,
    exitCode: number | null
  ) => void;
  getSession: (sessionId: string) => SessionDetail | null;
  gitPolling: SessionGitPolling;
  launchSession: (input: StoreBackedSessionLaunchInput) => Promise<SessionDetail>;
  listWorkspaces: () => WorkspaceSummary[];
  persistState: () => Promise<void>;
  repository: SessionRepository;
  restartCodexTransport: (
    session: SessionDetail,
    options: RestartCodexTransportOptions
  ) => Promise<SessionDetail>;
  restartClaudePromptTransport: (session: SessionDetail, input: string) => Promise<SessionDetail>;
  resumeCodexSession: (
    codexSession: CodexSessionSummary | CodexSessionDetail,
    prompt?: string
  ) => Promise<SessionDetail>;
  resumeAgentSession: (
    agentSession: AgentSessionSummary,
    prompt?: string
  ) => Promise<SessionDetail>;
  schedulePersistState: () => void;
  sendSourceInput: (
    session: SessionDetail,
    child: RunningChild | undefined,
    input: string
  ) => Promise<SessionDetail>;
  sendInput: (sessionId: string, input: string) => Promise<SessionDetail>;
  sessionRunner: SessionRunner;
  syncWorkspaceFromGit: (workspaceId: string, git: GitSnapshot) => void;
  supportsSourceInput: (adapterId: string) => boolean;
  toSummary: (session: SessionDetail) => SessionSummary;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};
