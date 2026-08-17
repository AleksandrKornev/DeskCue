import type { SessionDetail } from "@deskcue/protocol";

export type WorkspaceRow = {
  id: string;
  json: string;
};

export type SessionRow = {
  id: string;
  json: string;
};

export type SessionSummaryRow = {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  adapterId: string | null;
  sourceSessionId: string | null;
  command: string | null;
  status: SessionDetail["status"];
  startedAt: string;
  finishedAt: string | null;
  lastActivityAt: string;
  exitCode: number | null;
  previewJson: string | null;
  replyStateJson: string | null;
  actionRequestJson: string | null;
  gitJson: string | null;
};
