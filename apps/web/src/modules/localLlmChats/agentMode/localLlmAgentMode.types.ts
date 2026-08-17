export type LocalLlmAgentMode =
  | "read_only"
  | "ask"
  | "auto_workspace"
  | "full_access";

export type LocalLlmAgentCapabilities = {
  changesEnabled: boolean;
  mode: LocalLlmAgentMode;
  toolsEnabled: boolean;
  workspaceName: string | null;
};

export type LocalLlmActionRequest = {
  actionLabel: string;
  description: string;
  id: string;
  scope: string | null;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  title: string;
};

export type LocalLlmChangeEvidence = {
  description?: string;
  fileCount?: number;
  kind: "proposed" | "applied" | "observed";
};

export type LocalLlmActionRequestCardProps = {
  disabled?: boolean;
  request: LocalLlmActionRequest;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
};

export type LocalLlmAgentModePanelProps = {
  capabilities: LocalLlmAgentCapabilities;
  compact?: boolean;
};

export type LocalLlmChangeEvidenceLabelProps = {
  evidence: LocalLlmChangeEvidence;
};
