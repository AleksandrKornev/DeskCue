import { claudeCodeAdapter } from "@deskcue/adapters";
import type {
  AgentSessionSummary,
  GitSnapshot,
  SessionDetail,
  WorkspaceSummary
} from "@deskcue/protocol";
import {
  buildReadOnlySourceAgentSessionShell
} from "#agents/session/shell/sourceAgentSessionShell";

type BuildReadOnlyClaudeSessionShellInput = {
  agentSession: AgentSessionSummary;
  git: GitSnapshot;
  now?: string;
  observeOnly?: boolean;
  workspace: WorkspaceSummary;
};

export function buildReadOnlyClaudeSessionShell({
  agentSession,
  git,
  now = new Date().toISOString(),
  observeOnly = false,
  workspace
}: BuildReadOnlyClaudeSessionShellInput): SessionDetail {
  return buildReadOnlySourceAgentSessionShell({
    adapterId: claudeCodeAdapter.id,
    sourceSessionId: agentSession.sourceSessionId,
    sourceSessionFilePath: agentSession.filePath,
    command: `claude --resume ${agentSession.sourceSessionId} (${observeOnly ? "observe-only" : "read-only"})`,
    git,
    now,
    workspace
  });
}
