import type { LocalLlmRuntimeId } from "@deskcue/protocol";

export type CreateLocalChatRuntimeStatus =
  | "loading"
  | "ready"
  | "offline"
  | "unavailable";

export type CreateLocalChatRuntimeOption = {
  description: string;
  disabled?: boolean;
  id: LocalLlmRuntimeId;
  label: string;
  status: CreateLocalChatRuntimeStatus;
  statusText: string;
};

export type CreateLocalChatModelOption = {
  description?: string;
  id: string;
  label: string;
};

export type CreateLocalChatWorkspaceOption = {
  id: string;
  label: string;
  path?: string;
};

export type CreateLocalChatModelsLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export type CreateLocalChatDialogProps = {
  errorMessage?: string | null;
  isOpen: boolean;
  isSubmitting: boolean;
  modelErrorMessage?: string | null;
  models: readonly CreateLocalChatModelOption[];
  modelsLoadState: CreateLocalChatModelsLoadState;
  runtimes: readonly CreateLocalChatRuntimeOption[];
  selectedModelId: string;
  selectedRuntimeId: LocalLlmRuntimeId | null;
  selectedWorkspaceId: string;
  workspaces: readonly CreateLocalChatWorkspaceOption[];
  onClose: () => void;
  onCreate: () => void;
  onModelChange: (modelId: string) => void;
  onRetryModels: () => void;
  onRuntimeChange: (runtimeId: LocalLlmRuntimeId) => void;
  onWorkspaceChange: (workspaceId: string) => void;
};
