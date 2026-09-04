import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionDetail } from "@deskcue/protocol";

import { ManagedSessionPanel } from "./ManagedSessionPanel";
import type { ManagedSessionPanelProps } from "./types";

const viewModel = vi.hoisted(() => ({
  activeActionRequest: null,
  activePromptText: "",
  activeSelectedSession: null,
  canSendInput: false,
  chatComposerShellRef: { current: null },
  chatSurfaceRef: { current: null },
  chatToolbarRef: { current: null },
  chatWorkspaceStyle: {},
  composerPromptInFlight: false,
  contextCompactionCount: 0,
  debugEntries: [],
  inputUnavailableLabel: null,
  isCompactViewport: true,
  isInterruptingPrompt: false,
  isPromptQueued: false,
  isTakenOverChat: true,
  liveChatThreadProps: {},
  liveHeaderStatus: "ready",
  liveHeaderStatusLabel: "Ready",
  liveSessionSubtitle: "Source session",
  liveSessionTitle: "Recovered source chat",
  previewCandidates: [],
  previewCandidatesError: null,
  previewCandidatesLoading: false,
  previewDocumentRevision: 0,
  previewError: null,
  previewLoading: false,
  previewRetry: vi.fn(),
  previewReview: { reload: vi.fn() },
  previewUrl: null,
  previewValidate: vi.fn(),
  selectedSessionDetail: null,
  sessionShell: null as SessionDetail | null,
  setShowModelContext: vi.fn(),
  sharedSessionHint: null,
  sharedViewerCount: 0,
  showModelContext: false,
  sourceDiffParts: [],
  switchableManagedSessions: []
}));

vi.mock("@runtime", () => ({
  useDeskCueRuntime: () => ({
    features: { files: true, gitRefresh: false, preview: true },
    launchSessionPreview: null
  })
}));

vi.mock("@web/layout", () => ({
  useDeskCueLayoutMode: () => "compact"
}));

vi.mock("./model/useManagedSessionPanelViewModel", () => ({
  useManagedSessionPanelViewModel: () => viewModel
}));

vi.mock("./model/capabilities/useExternalClaudeBackgroundStopCapability", () => ({
  useExternalClaudeBackgroundStopCapability: () => ({
    isAvailable: false,
    refresh: vi.fn()
  })
}));

vi.mock("./chrome", () => ({
  LiveSessionActions: () => null,
  LiveSessionHeader: ({ navigationCapabilities }: {
    navigationCapabilities: Record<string, boolean>;
  }) => (
    <div data-testid="live-session-navigation-capabilities">
      {JSON.stringify(navigationCapabilities)}
    </div>
  ),
  ManagedSessionSwitcher: () => null
}));

vi.mock("./diagnostics", () => ({
  SessionDiagnosticsDialog: () => null
}));

vi.mock("./liveChatOverview", () => ({
  LiveChatOverview: () => <div>Recovered source chat content</div>
}));

vi.mock("./manualSession", () => ({
  ManualSessionChrome: () => null,
  ManualSessionOverview: () => null
}));

vi.mock("./tabs", () => ({
  DiffTabPanel: () => null,
  FilesTabPanel: () => null,
  LogsTabPanel: () => null,
  PreviewTabPanel: () => null
}));

vi.mock("@modules/modelRuntime", () => ({
  ModelRuntimePanel: () => null
}));

function createSession(id: string): SessionDetail {
  return {
    adapterId: "codex",
    id,
    preview: { active: false },
    sourceSessionId: `source-${id}`,
    status: "running",
    workspaceId: "workspace-1"
  } as SessionDetail;
}

function createProps(onRetrySessionLoad: () => Promise<unknown>): ManagedSessionPanelProps {
  return {
    activeTab: "overview",
    agentSessions: [],
    managedSessions: [],
    agentTranscriptHasMoreById: new Map(),
    agentTranscriptHistoryIncompleteById: new Map(),
    immediateInterruptPrompt: null,
    isBootstrapping: false,
    isInterruptingPrompt: false,
    isTakenOverAgentSessionLoading: false,
    isWaitingForChatReply: false,
    liveUpdatesConnection: { lastSyncedAt: null, status: "offline" },
    pendingChatPrompt: null,
    previewPort: "",
    selectedSession: null,
    selectedSessionId: "session-1",
    sessionLoadError: "Safe source session recovery message",
    takenOverAgentSession: null,
    onChangePreviewNetworkMode: vi.fn(),
    onChangePreviewPort: vi.fn(),
    onExitSession: vi.fn(),
    onHydrateAgentSessionChanges: vi.fn(() =>
      Promise.resolve({ files: [], groupId: "", sessionId: "" })
    ),
    onHydrateAgentSessionTranscriptEntries: vi.fn(() => Promise.resolve([])),
    onInterruptPrompt: vi.fn(),
    onLoadMoreAgentSessionTranscript: vi.fn(() => Promise.resolve(0)),
    onRefreshGit: vi.fn(),
    onRetrySessionLoad,
    onSelectSession: vi.fn(),
    onOpenSubagentSession: vi.fn(),
    onSelectTab: vi.fn(),
    onSendInput: vi.fn(() => Promise.resolve(false)),
    onSetPreview: vi.fn(),
    onStopAndExitSession: vi.fn(),
    onStopPreview: vi.fn(),
    onStopSession: vi.fn()
  };
}

describe("ManagedSessionPanel initial load recovery", () => {
  beforeEach(() => {
    viewModel.sessionShell = null;
  });

  it("moves owned Retry focus to the recovered source session", async () => {
    let resolveRetry: (() => void) | undefined;
    const retry = vi.fn(() => new Promise<void>((resolve) => {
      resolveRetry = resolve;
    }));
    const props = createProps(retry);
    const view = render(<ManagedSessionPanel {...props} />);
    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();
    fireEvent.click(retryButton);
    viewModel.sessionShell = createSession("session-1");

    await act(async () => {
      resolveRetry?.();
      await Promise.resolve();
    });

    view.rerender(<ManagedSessionPanel {...props} sessionLoadError={null} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Session loaded")).toHaveFocus();
    });
  });

  it("does not move focus after the panel unmounts during Retry", async () => {
    let resolveRetry: (() => void) | undefined;
    const retry = vi.fn(() => new Promise<void>((resolve) => {
      resolveRetry = resolve;
    }));
    const view = render(<ManagedSessionPanel {...createProps(retry)} />);
    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();
    fireEvent.click(retryButton);
    view.unmount();

    await act(async () => {
      resolveRetry?.();
      await Promise.resolve();
    });

    expect(document.body).toHaveFocus();
  });

  it("keeps all four local source-chat sections available before a workspace is attached", () => {
    viewModel.sessionShell = createSession("session-1");

    render(
      <ManagedSessionPanel
        {...createProps(() => Promise.resolve())}
        hasPreview={false}
        hasWorkspaceFiles={false}
        sessionLoadError={null}
      />
    );

    expect(screen.getByTestId("live-session-navigation-capabilities")).toHaveTextContent(
      JSON.stringify({
        conversation: true,
        output: false,
        changes: true,
        files: true,
        preview: true
      })
    );
  });
});
