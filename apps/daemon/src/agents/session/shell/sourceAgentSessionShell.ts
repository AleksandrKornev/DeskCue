import { randomUUID } from "node:crypto";

import type {
  GitSnapshot,
  SessionDetail,
  WorkspaceSummary
} from "@deskcue/protocol";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

type BuildReadOnlySourceAgentSessionShellInput = {
  adapterId: string;
  command: string;
  git: GitSnapshot;
  now?: string;
  sourceSessionFilePath?: string | null;
  sourceSessionId: string;
  workspace: WorkspaceSummary;
};

export function buildReadOnlySourceAgentSessionShell({
  adapterId,
  command,
  git,
  now = new Date().toISOString(),
  sourceSessionFilePath,
  sourceSessionId,
  workspace
}: BuildReadOnlySourceAgentSessionShellInput): SessionDetail {
  return {
    id: randomUUID(),
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    adapterId,
    sourceSessionId,
    ...(sourceSessionFilePath === undefined ? {} : { sourceSessionFilePath }),
    command,
    status: "read_only",
    startedAt: now,
    finishedAt: now,
    lastActivityAt: now,
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    actionRequest: null,
    git,
    logs: [],
    inputHistory: []
  };
}
