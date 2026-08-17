import type {
  LocalLlmChatSummary,
  LocalLlmRuntimeId,
  RuntimeSummary
} from "@deskcue/protocol";

export interface LocalChatCreationModel {
  displayName: string;
  modelKey: string;
}

export type LocalChatRuntimeCatalogState =
  | {
    error: null;
    models: LocalChatCreationModel[];
    runtime: null;
    status: "idle" | "starting_runtime";
  }
  | {
    error: null;
    models: LocalChatCreationModel[];
    runtime: RuntimeSummary;
    status: "loading_models" | "ready";
  }
  | {
    error: string;
    models: LocalChatCreationModel[];
    runtime: RuntimeSummary | null;
    status: "error";
  };

export interface LocalChatCreationController {
  canCreate: boolean;
  catalog: LocalChatRuntimeCatalogState;
  close: () => void;
  create: () => Promise<LocalLlmChatSummary | null>;
  error: string | null;
  isOpen: boolean;
  open: () => void;
  retryCatalog: () => void;
  runtimeId: LocalLlmRuntimeId;
  selectedModelKey: string;
  setRuntimeId: (runtimeId: LocalLlmRuntimeId) => void;
  setSelectedModelKey: (modelKey: string) => void;
  setWorkspaceId: (workspaceId: string) => void;
  submitting: boolean;
  workspaceId: string;
}

export interface UseLocalChatCreationOptions {
  defaultRuntimeId?: LocalLlmRuntimeId;
  onCreated: (chat: LocalLlmChatSummary) => void;
}
