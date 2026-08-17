import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OverviewResponse, SessionDetail } from "@deskcue/protocol";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import type { SessionTab } from "@models/sessionTabs";
import {
  createCloudMachineDeskCueRuntime,
  initializeDeskCueRuntime,
  resetDeskCueRuntimeForTests
} from "@runtime";

import { useSelectedManagedSessionController } from "./useSelectedManagedSessionController";

const selectedSession = {
  adapterId: "codex",
  command: "codex resume source-1",
  exitCode: null,
  finishedAt: null,
  git: {
    branch: null,
    changedFiles: [],
    diff: "",
    isDirty: false,
    isGitRepo: false,
    lastUpdatedAt: "2026-08-07T00:00:00.000Z"
  },
  id: "managed-1",
  inputHistory: [],
  lastActivityAt: "2026-08-07T00:00:00.000Z",
  logs: [],
  preview: { active: false, artifacts: [], networkMode: "device-direct", port: null, targetUrl: null },
  replyState: { phase: "idle", promptText: null, requestedAt: null },
  sourceSessionId: "source-1",
  startedAt: "2026-08-07T00:00:00.000Z",
  status: "running",
  workspaceId: "workspace-1",
  workspaceName: "Workspace"
} satisfies SessionDetail;

const overview = {
  clientContext: { canOpenNativeDialogs: false },
  sessions: [selectedSession],
  workspaces: []
} satisfies OverviewResponse;

describe("useSelectedManagedSessionController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDeskCueRuntimeForTests();
    window.history.replaceState({}, "", "/");
  });

  it("validates a restored selected-session cache against the daemon", async () => {
    const loadSession = vi.fn(() => Promise.resolve(selectedSession));

    renderHook(() => useSelectedManagedSessionController({
      activeTab: "preview",
      isBootstrapping: false,
      loadSession,
      overview,
      selectedAgentSessionId: "",
      selectedSession,
      selectedSessionId: selectedSession.id,
      selectedSessionIdRef: { current: selectedSession.id },
      selectedWorkspaceId: selectedSession.workspaceId,
      setSelectedSession: vi.fn(),
      setSelectedSessionId: vi.fn(),
      setSelectedWorkspaceId: vi.fn(),
      suppressManagedSessionAutoSelect: false
    }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadSession).toHaveBeenCalledWith(selectedSession.id, {
      sessionView: "chat",
      silent: true
    });
  });

  it("loads Debug again after leaving and re-entering the tab", async () => {
    const loadSession = vi.fn(() => Promise.resolve(selectedSession));
    const stableProps = {
      isBootstrapping: false,
      loadSession,
      overview,
      selectedAgentSessionId: "",
      selectedSession,
      selectedSessionId: selectedSession.id,
      selectedSessionIdRef: { current: selectedSession.id },
      selectedWorkspaceId: selectedSession.workspaceId,
      setSelectedSession: vi.fn(),
      setSelectedSessionId: vi.fn(),
      setSelectedWorkspaceId: vi.fn(),
      suppressManagedSessionAutoSelect: false
    };
    const { rerender } = renderHook(
      ({ activeTab }: { activeTab: SessionTab }) =>
        useSelectedManagedSessionController({
          ...stableProps,
          activeTab
        }),
      { initialProps: { activeTab: "logs" as SessionTab } }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(loadSession).toHaveBeenLastCalledWith(selectedSession.id, {
      debugLogTail: 80,
      sessionView: "debug",
      silent: true
    });

    rerender({ activeTab: "activity" });
    await act(async () => {
      await Promise.resolve();
    });
    rerender({ activeTab: "logs" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadSession).toHaveBeenCalledTimes(3);
    expect(loadSession).toHaveBeenLastCalledWith(selectedSession.id, {
      debugLogTail: 80,
      sessionView: "debug",
      silent: true
    });
  });

  it("hydrates the diff view when Changes opens after a cached chat view", async () => {
    const loadSession = vi.fn(() => Promise.resolve(selectedSession));
    vi.spyOn(sessionsApi, "refreshGitWithMeta").mockResolvedValue({
      data: selectedSession,
      etag: null,
      notModified: false,
      status: 200
    });
    const stableProps = {
      isBootstrapping: false,
      loadSession,
      overview,
      selectedAgentSessionId: "",
      selectedSession,
      selectedSessionId: selectedSession.id,
      selectedSessionIdRef: { current: selectedSession.id },
      selectedWorkspaceId: selectedSession.workspaceId,
      setSelectedSession: vi.fn(),
      setSelectedSessionId: vi.fn(),
      setSelectedWorkspaceId: vi.fn(),
      suppressManagedSessionAutoSelect: false
    };
    const { rerender } = renderHook(
      ({ activeTab }: { activeTab: SessionTab }) => useSelectedManagedSessionController({
        ...stableProps,
        activeTab
      }),
      { initialProps: { activeTab: "overview" as SessionTab } }
    );

    await act(async () => {
      await Promise.resolve();
    });
    rerender({ activeTab: "diff" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadSession).toHaveBeenLastCalledWith(selectedSession.id, {
      sessionView: "diff",
      silent: true
    });
  });

  it("refreshes source-session workspace changes once when Changes first opens", async () => {
    const refreshedSession = {
      ...selectedSession,
      git: {
        ...selectedSession.git,
        branch: "main",
        changedFiles: ["README.md"],
        isDirty: true,
        isGitRepo: true
      }
    } satisfies SessionDetail;
    const refreshGitWithMeta = vi.spyOn(sessionsApi, "refreshGitWithMeta").mockResolvedValue({
      data: refreshedSession,
      etag: null,
      notModified: false,
      status: 200
    });
    const setSelectedSession = vi.fn();
    const stableProps = {
      activeTab: "diff" as SessionTab,
      isBootstrapping: false,
      loadSession: vi.fn(() => Promise.resolve(selectedSession)),
      overview,
      selectedAgentSessionId: "codex:source-1",
      selectedSession,
      selectedSessionId: selectedSession.id,
      selectedSessionIdRef: { current: selectedSession.id },
      selectedWorkspaceId: selectedSession.workspaceId,
      setSelectedSession,
      setSelectedSessionId: vi.fn(),
      setSelectedWorkspaceId: vi.fn(),
      suppressManagedSessionAutoSelect: false
    };
    const initialProps: { session: SessionDetail } = { session: selectedSession };
    const { rerender } = renderHook(
      ({ session }: { session: SessionDetail }) => useSelectedManagedSessionController({
        ...stableProps,
        selectedSession: session
      }),
      { initialProps }
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshGitWithMeta).toHaveBeenCalledTimes(1);
    expect(refreshGitWithMeta).toHaveBeenCalledWith(selectedSession.id, {
      view: "diff"
    });
    expect(setSelectedSession).toHaveBeenCalledWith(refreshedSession);

    rerender({ session: { ...refreshedSession } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshGitWithMeta).toHaveBeenCalledTimes(1);
  });

  it("does not auto-refresh git when a Cloud runtime has no refresh capability", async () => {
    window.history.replaceState({}, "", "/machines/machine-1/deskcue/");
    initializeDeskCueRuntime(createCloudMachineDeskCueRuntime(window.location));
    const refreshGitWithMeta = vi.spyOn(sessionsApi, "refreshGitWithMeta");

    renderHook(() => useSelectedManagedSessionController({
      activeTab: "diff",
      isBootstrapping: false,
      loadSession: vi.fn(() => Promise.resolve(selectedSession)),
      overview,
      selectedAgentSessionId: "codex:source-1",
      selectedSession,
      selectedSessionId: selectedSession.id,
      selectedSessionIdRef: { current: selectedSession.id },
      selectedWorkspaceId: selectedSession.workspaceId,
      setSelectedSession: vi.fn(),
      setSelectedSessionId: vi.fn(),
      setSelectedWorkspaceId: vi.fn(),
      suppressManagedSessionAutoSelect: false
    }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshGitWithMeta).not.toHaveBeenCalled();
  });
});
