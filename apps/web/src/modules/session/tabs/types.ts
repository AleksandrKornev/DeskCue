import type { PropsWithChildren, ReactNode, SubmitEvent } from "react";

import type {
  PreviewCandidate,
  PreviewNetworkMode,
  SessionActionRequest,
  SessionDetail
} from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type { SendInputOptions } from "@models/promptDelivery";
import type { DiffPart } from "@modules/transcript";

export type DebugEntry = {
  id: string;
  stream: SessionDetail["logs"][number]["stream"];
  timestamp: string;
  text: string;
};

export type DebugEventListProps = {
  debugEntries: DebugEntry[];
  hasSelectedSession: boolean;
  hasSourceSession: boolean;
};

export type LogsTabPanelProps = {
  activePromptText: string | null;
  actionRequest: SessionActionRequest | null;
  canSendInput: boolean;
  debugEntries: DebugEntry[];
  draftScopeKey: string;
  hasSelectedSession: boolean;
  hasSourceSession: boolean;
  inputUnavailableLabel: string | null;
  isInterruptingPrompt: boolean;
  isPromptInFlight: boolean;
  isPromptQueued: boolean;
  liveUpdatesConnection: LiveUpdatesConnectionState;
  sharedSessionHint: string | null;
  viewerCount: number;
  onInterruptPrompt: () => void;
  onSendInput: (instruction: string, options?: SendInputOptions) => Promise<boolean>;
};

export type DiffTabPanelProps = {
  git: SessionDetail["git"] | null;
  preferredFilePath?: string;
  showWorkspaceGit?: boolean;
  sourceDiffParts: DiffPart[];
  onOpenFile?: (path: string) => void;
  onRefreshGit?: () => void | Promise<void>;
  onSelectFile?: (path: string) => void;
};

export type TabPanelSurfaceProps = PropsWithChildren<{
  title: string;
  action?: ReactNode;
  subtitle?: string;
}>;

export type PreviewTabPanelProps = {
  configuredPreviewPort: number | null;
  configuredPreviewNetworkMode: PreviewNetworkMode;
  hasSelectedSession: boolean;
  previewCandidates: PreviewCandidate[];
  previewCandidatesError: string;
  previewCandidatesLoading: boolean;
  previewDocumentRevision: number;
  previewError: string;
  previewLoading: boolean;
  previewPort: string;
  previewReloadVersion: number;
  previewUrl: string | null;
  onChangePreviewPort: (value: string) => void;
  onChangePreviewNetworkMode: (value: PreviewNetworkMode) => boolean | Promise<boolean>;
  onReloadPreview: () => void;
  onLaunchPreview?: () => Promise<void>;
  onRetryPreview: () => void;
  onSetPreview: (event: SubmitEvent<HTMLFormElement>) => Promise<void>;
  onStopPreview: () => boolean | Promise<boolean>;
};
