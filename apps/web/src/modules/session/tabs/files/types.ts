import type { WorkspaceFileEntry, WorkspaceFileResponse } from "@deskcue/protocol";

export type FilesTabPanelProps = {
  changedFiles?: string[];
  requestedPath?: string;
  workspaceId: string | null;
  workspaceName?: string | null;
  onOpenChanges?: (path: string) => void;
  onSelectFile?: (path: string) => void;
};

export type WorkspaceFileBrowserState = {
  currentPath: string;
  entries: WorkspaceFileEntry[];
  error: string;
  file: WorkspaceFileResponse | null;
  hasMore: boolean;
  loadingDirectory: boolean;
  loadingFile: boolean;
  limited: boolean;
  selectedPath: string;
  loadMore: () => void;
  openDirectory: (path: string) => void;
  openFile: (path: string) => void;
  openPath: (path: string) => Promise<"directory" | "file" | null>;
};

export type WorkspaceFileHistoryTarget = {
  kind: "directory" | "file";
  path: string;
  workspaceId: string;
};
