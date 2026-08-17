import { genericCliAdapter } from "@deskcue/adapters";
import type { CreateSessionInput, SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";

export type SessionStartCallbacks = {
  getWorkspace: (workspaceId: string) => WorkspaceSummary | null;
  launchSession: (sessionInput: {
    adapterId: string;
    argvInput?: string;
    command: string;
    cwd: string;
    env: Record<string, string | undefined>;
    initialInput?: string;
    sourceSessionId: string | null;
    spawnSpec?: {
      file: string;
      args: string[];
    };
    workspace: WorkspaceSummary;
  }) => Promise<SessionDetail>;
};

export async function startGenericCliSession(
  callbacks: SessionStartCallbacks,
  input: CreateSessionInput
): Promise<SessionDetail> {
  const workspace = callbacks.getWorkspace(input.workspaceId);
  if (!workspace) {
    throw new AppError("not_found", "Workspace not found.");
  }

  const normalized = genericCliAdapter.normalize(input.command, workspace.path);
  if (!normalized.command) {
    throw new AppError("invalid_input", "Command cannot be empty.");
  }

  return callbacks.launchSession({
    workspace,
    command: normalized.command,
    cwd: normalized.cwd,
    env: normalized.env ?? {},
    adapterId: genericCliAdapter.id,
    sourceSessionId: null
  });
}
