import type {
  LocalLlmChatDetail,
  RuntimeSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { LmStudioInstalledModel } from "@api/endpoint/dashboard/endpoints";

export type LocalLlmHistoryStream = keyof LocalLlmChatDetail["history"];
export type LocalLlmProtectedRecordIds = Partial<
  Record<LocalLlmHistoryStream, ReadonlySet<string>>
>;

export type LocalLlmChatComposerSupplementProps = {
  detail: LocalLlmChatDetail;
  startingLmStudio: boolean;
  onDiscardLmStudioPrompt: () => void;
  onResolveAction: (
    actionRequestId: string,
    decision: "approve" | "reject"
  ) => void;
  onStartLmStudioAndSend: () => void;
};

export type LocalLlmManagedSessionDialogsProps = {
  detail: LocalLlmChatDetail;
  lmStudioModelDialogOpen: boolean;
  lmStudioModels: LmStudioInstalledModel[] | null;
  modeDialogOpen: boolean;
  selectedLmStudioModelKey: string;
  updatingLmStudioModel: boolean;
  updatingWorkspace: boolean;
  workspaceDialogOpen: boolean;
  workspaceId: string;
  workspaces: WorkspaceSummary[];
  onAgentModeUpdate: (agentMode: LocalLlmChatDetail["agentMode"]) => void;
  onCloseLmStudioModelDialog: () => void;
  onCloseModeDialog: () => void;
  onCloseWorkspaceDialog: () => void;
  onLmStudioModelUpdate: () => void;
  onSelectedLmStudioModelKeyChange: (modelKey: string) => void;
  onWorkspaceIdChange: (workspaceId: string) => void;
  onWorkspaceUpdate: () => void;
};

export type LocalLlmManagedSessionPanelProps = {
  chatId: string;
  runtimes: RuntimeSummary[];
  workspaces: WorkspaceSummary[];
  onExit: () => void;
};
