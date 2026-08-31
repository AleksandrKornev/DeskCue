import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  buildAgentBrowserShellProps,
  buildManagedSessionShellProps,
  buildSecondaryToolsShellProps
} from "./helpers";
import type {
  BuildAgentBrowserShellPropsArgs,
  BuildManagedSessionShellPropsArgs,
  BuildSecondaryToolsShellPropsArgs
} from "./types";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: toastMocks
}));

type CreateSecondaryToolsArgsOptions = {
  onAddWorkspaceAction?: BuildSecondaryToolsShellPropsArgs["manualRunnerActions"]["handleAddWorkspaceAction"];
  onPickWorkspaceAction?: BuildSecondaryToolsShellPropsArgs["manualRunnerActions"]["handlePickWorkspaceAction"];
};

function createSecondaryToolsArgs({
  onAddWorkspaceAction = vi.fn().mockResolvedValue({ status: "created" }),
  onPickWorkspaceAction = vi.fn().mockResolvedValue({ status: "created" })
}: CreateSecondaryToolsArgsOptions = {}): BuildSecondaryToolsShellPropsArgs {
  return {
    overview: {
      canOpenNativeDialogs: true,
      isBootstrapping: false,
      overview: {
        clientContext: { canOpenNativeDialogs: true },
        sessions: [],
        workspaces: []
      },
      sourceCards: [],
      visibleRuntimes: []
    },
    agentBrowser: {
      agentSessions: []
    },
    manualRunner: {
      command: "codex",
      loading: false,
      selectedWorkspaceId: "",
      workspacePath: "D:\\work",
      workspaceLoading: false,
      workspacePicking: false
    },
    manualRunnerActions: {
      handleAddWorkspaceAction: onAddWorkspaceAction,
      handlePickWorkspaceAction: onPickWorkspaceAction,
      handleStartSession: vi.fn(),
      setCommand: vi.fn(),
      setSelectedWorkspaceId: vi.fn(),
      setWorkspacePath: vi.fn()
    }
  };
}

function createAgentBrowserArgs(): BuildAgentBrowserShellPropsArgs {
  return {
    overview: {
      canOpenNativeDialogs: true,
      isBootstrapping: false,
      overview: {
        clientContext: { canOpenNativeDialogs: true },
        sessions: [],
        workspaces: []
      },
      sourceCards: [],
      visibleRuntimes: []
    },
    agentBrowser: {
      agentSessionsHasMore: true,
      agentSessionsLoadState: "ready",
      agentSessionsQuery: "owned",
      agentSessionsTotalCountLabel: "17",
      filteredAgentSessions: [],
      isAgentSessionLoading: true,
      readyForReviewAgentSessionIds: ["review-1"],
      selectedAgentSession: null,
      selectedAgentSessionLoadError: "selected agent failed"
    },
    managedSession: {
      managedSessions: []
    },
    manualRunner: {
      workspacePath: "D:\\workspace",
      workspaceLoading: true,
      workspacePicking: false
    },
    prompt: {
      pendingChatPrompt: null
    },
    agentBrowserActions: {
      markAgentSessionReviewed: vi.fn(),
      refreshSelectedAgentSession: vi.fn()
    },
    manualRunnerActions: {
      handleAddWorkspaceAction: vi.fn().mockResolvedValue({ status: "created" }),
      handlePickWorkspaceAction: vi.fn().mockResolvedValue({ status: "created" }),
      setWorkspacePath: vi.fn()
    },
    agentBrowserLoaders: {
      loadAgentSessions: vi.fn().mockResolvedValue([]),
      loadMoreAgentSessions: vi.fn().mockResolvedValue([]),
      searchAgentSessions: vi.fn().mockResolvedValue([])
    },
    route: {
      attachedManagedSessionId: "managed-1",
      attachedManagedSessionInfo: null,
      effectiveSelectedAgentSessionId: "agent-1",
      effectiveSelectedSourceId: "codex",
      isOpeningSelectedAgentSession: true
    },
    routeActions: {
      onAttachSelectedAgentSession: vi.fn(),
      onClearAgentSessionSelection: vi.fn(),
      onOpenLocalLlmChat: vi.fn(),
      onOpenManagedSession: vi.fn(),
      onSelectAgentSession: vi.fn(),
      onSelectSource: vi.fn()
    }
  };
}

function createManagedSessionArgs(): BuildManagedSessionShellPropsArgs {
  return {
    overview: {
      isBootstrapping: true
    },
    agentBrowser: {
      agentSessions: [],
      agentTranscriptHasMoreById: new Map([["agent-1", true]])
    },
    managedSession: {
      activeTab: "preview",
      liveUpdatesConnection: { lastSyncedAt: null, status: "live" },
      managedSessions: [],
      previewPort: "5173",
      selectedSession: null
    },
    prompt: {
      immediateInterruptPrompt: null,
      isInterruptingPrompt: true,
      isWaitingForChatReply: false,
      pendingChatPrompt: null
    },
    agentBrowserActions: {
      hydrateAgentSessionChanges: vi.fn().mockResolvedValue({ changeSets: [] }),
      hydrateAgentSessionTranscriptEntries: vi.fn().mockResolvedValue([]),
      loadMoreAgentSessionTranscript: vi.fn().mockResolvedValue(0)
    },
    managedSessionActions: {
      handleChangePreviewNetworkMode: vi.fn().mockResolvedValue(true),
      handleRefreshGit: vi.fn(),
      handleSetPreview: vi.fn(),
      handleStopPreview: vi.fn().mockResolvedValue(true),
      retryInitialManagedSessionLoad: vi.fn().mockResolvedValue(null),
      setPreviewPort: vi.fn()
    },
    route: {
      effectiveSelectedSessionId: "session-1",
      initialManagedSessionLoadState: { kind: "loaded" },
      isTakenOverAgentSessionLoading: true,
      takenOverAgentSession: null
    },
    routeActions: {
      onExitSession: vi.fn(),
      onInterruptPrompt: vi.fn(),
      onSelectManagedSession: vi.fn(),
      onSelectSessionTab: vi.fn(),
      onSendInput: vi.fn().mockResolvedValue(true),
      onStopAndExitSession: vi.fn(),
      onStopSession: vi.fn(() => true)
    }
  };
}

describe("section prop builders", () => {
  it("maps Agent Browser state and action identities from their owned groups", () => {
    const args = createAgentBrowserArgs();
    const props = buildAgentBrowserShellProps(args);

    expect(props).toMatchObject({
      agentSessions: args.agentBrowser.filteredAgentSessions,
      attachedManagedSessionId: "managed-1",
      pickingWorkspace: false,
      selectedAgentSessionId: "agent-1",
      selectedAgentSessionLoadError: "selected agent failed",
      selectedSourceId: "codex",
      totalAgentSessionsCount: "17",
      workspaceLoading: true,
      workspacePath: "D:\\workspace"
    });

    expect(props.managedSessions).toBe(args.managedSession.managedSessions);
    expect(props.onLoadMoreAgentSessions).toBe(args.agentBrowserLoaders.loadMoreAgentSessions);
    expect(props.onRetrySelectedAgentSession).toBe(args.agentBrowserActions.refreshSelectedAgentSession);
    expect(props.onAddWorkspace).toBe(args.manualRunnerActions.handleAddWorkspaceAction);
  });

  it("maps Managed Session state and action identities from their owned groups", () => {
    const args = createManagedSessionArgs();
    const props = buildManagedSessionShellProps(args);

    expect(props).toMatchObject({
      activeTab: "preview",
      isBootstrapping: true,
      isInterruptingPrompt: true,
      isTakenOverAgentSessionLoading: true,
      previewPort: "5173",
      selectedSessionId: "session-1"
    });

    expect(props.agentSessions).toBe(args.agentBrowser.agentSessions);
    expect(props.agentTranscriptHasMoreById).toBe(args.agentBrowser.agentTranscriptHasMoreById);
    expect(props.onChangePreviewPort).toBe(args.managedSessionActions.setPreviewPort);
    expect(props.onHydrateAgentSessionChanges).toBe(args.agentBrowserActions.hydrateAgentSessionChanges);
    expect(props.onSendInput).toBe(args.routeActions.onSendInput);
  });
});

describe("buildSecondaryToolsShellProps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a failed native workspace pick from Manual controls", async () => {
    const onPickWorkspaceAction = vi.fn().mockResolvedValue({
      status: "failed",
      error: "Folder picker failed"
    });
    const props = buildSecondaryToolsShellProps(createSecondaryToolsArgs({
      onPickWorkspaceAction
    }));

    props.onPickWorkspace();

    await vi.waitFor(() => {
      expect(onPickWorkspaceAction).toHaveBeenCalledOnce();
      expect(toastMocks.error).toHaveBeenCalledWith("Folder picker failed");
    });
  });

  it("reports a failed path submission from Manual controls", async () => {
    const onAddWorkspaceAction = vi.fn().mockResolvedValue({
      status: "failed",
      error: "Workspace is unavailable"
    });
    const props = buildSecondaryToolsShellProps(createSecondaryToolsArgs({
      onAddWorkspaceAction
    }));

    render(createElement(
      "form",
      { "aria-label": "Workspace form", onSubmit: props.onAddWorkspace },
      createElement("button", { type: "submit" }, "Add workspace")
    ));
    fireEvent.submit(screen.getByRole("form", { name: "Workspace form" }));

    await vi.waitFor(() => {
      expect(onAddWorkspaceAction).toHaveBeenCalledOnce();
      expect(toastMocks.error).toHaveBeenCalledWith("Workspace is unavailable");
    });
  });

  it("does not report cancelled workspace actions", async () => {
    const onPickWorkspaceAction = vi.fn().mockResolvedValue({ status: "cancelled" });
    const props = buildSecondaryToolsShellProps(createSecondaryToolsArgs({
      onPickWorkspaceAction
    }));

    props.onPickWorkspace();

    await vi.waitFor(() => expect(onPickWorkspaceAction).toHaveBeenCalledOnce());
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
