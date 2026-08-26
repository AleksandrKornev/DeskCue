export type AgentKind =
  | "codex"
  | "claude-code"
  | "other";

export type CodexApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never";

export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export interface AgentSessionObservedTurnState {
  activityAt: string | null;
  completedAt: string | null;
  evidence:
    | "none"
    | "recent_non_final_activity"
    | "terminal_lifecycle"
    | "turn_lifecycle"
    | "unanswered_user_turn"
    | "user_after_terminal";
  fingerprint: string | null;
  phase: "idle" | "active" | "completed" | "failed" | "interrupted";
  startedAt: string | null;
  turnStartFingerprint?: string | null;
}

export interface AgentSessionInterruptLifecycle {
  phase: "idle" | "requested" | "confirmed" | "unresolved";
  requestedAt: string | null;
  confirmedAt: string | null;
  turnFingerprint: string | null;
  confirmation: "source_terminal" | "managed_transport" | "verified_process" | null;
  outcome: "interrupted" | "completed" | "failed" | null;
}

export type ExternalForceStopCapability =
  | {
      kind: "available";
      processId: number;
      processCreatedAt: string;
    }
  | {
      kind: "unavailable";
      reason: string;
    };

export interface ExternalForceStopTarget {
  processId: number;
  processCreatedAt: string;
}

export type ExternalDesktopInterruptCapability =
  | {
      kind: "available";
    }
  | {
      kind: "unavailable";
      reason: string;
    };

export type ExternalClaudeBackgroundStopCapability =
  | {
      kind: "available";
      jobId: string;
      state: "working" | "blocked";
    }
  | {
      kind: "unavailable";
      reason: string;
    };

/**
 * Stable source-session identity shared by session discovery and transcript
 * projections. It intentionally has no dependency on either transport shape.
 */
export interface AgentSessionSummary {
  id: string;
  agentId: AgentKind;
  agentLabel: string;
  sourceSessionId: string;
  title: string;
  workspacePath: string | null;
  workspaceName: string | null;
  updatedAt: string;
  model: string | null;
  originator: string | null;
  cliVersion: string | null;
  source: string | null;
  filePath: string;
  contextCompactionCount?: number;
  approvalPolicy?: CodexApprovalPolicy | null;
  sandboxMode?: CodexSandboxMode | null;
  attachMode: "resume" | "read_only";
  attachModeReason?: string | null;
  reviewedAt?: string | null;
  workState: "idle" | "running";
  turnState?: AgentSessionObservedTurnState;
  interruptLifecycle?: AgentSessionInterruptLifecycle;
}
