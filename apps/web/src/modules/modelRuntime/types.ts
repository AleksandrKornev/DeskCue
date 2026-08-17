import type {
  AgentSessionDetail,
  AgentSessionSummary,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";

export type ModelRuntimePanelProps = {
  agentSession?: AgentSessionDetail | AgentSessionSummary | null;
  onClose: () => void;
  session?: SessionDetail | SessionSummary | null;
};

export type ModelRuntimeDetailItem = {
  label: string;
  value: string | null | undefined;
};

export type ModelRuntimeAdapterDetails = {
  label: string;
  runtimeKind: string;
  capabilities: string;
};

export type ModelRuntimeModelInfo = {
  name: string | null;
  source: string | null;
};

export type BuildModelRuntimeDetailItemsInput = {
  adapterDetails: ModelRuntimeAdapterDetails;
  agentSession: AgentSessionDetail | AgentSessionSummary | null | undefined;
  mode: string;
  model: ModelRuntimeModelInfo;
  session: SessionDetail | SessionSummary | null | undefined;
};
