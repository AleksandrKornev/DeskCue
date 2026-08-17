import { codexAdapter } from "@deskcue/adapters";
import type {
  CodexSessionDetail,
  CodexSessionSummary,
  GitSnapshot,
  SessionDetail,
  WorkspaceSummary
} from "@deskcue/protocol";
import {
  buildReadOnlySourceAgentSessionShell
} from "#agents/session/shell/sourceAgentSessionShell";

type BuildReadOnlyCodexSessionShellInput = {
  codexSession: CodexSessionSummary | CodexSessionDetail;
  git: GitSnapshot;
  now?: string;
  workspace: WorkspaceSummary;
};

export function buildReadOnlyCodexSessionShell({
  codexSession,
  git,
  now = new Date().toISOString(),
  workspace
}: BuildReadOnlyCodexSessionShellInput): SessionDetail {
  return buildReadOnlySourceAgentSessionShell({
    adapterId: codexAdapter.id,
    sourceSessionId: codexSession.id,
    command: `codex resume ${codexSession.id} (read-only)`,
    git,
    now,
    workspace
  });
}
