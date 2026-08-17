import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";
import type { SessionTab } from "@models/sessionTabs";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";
import type { DashboardStore } from "@modules/dashboard/model/store";

import { useDashboardLiveUpdates } from "./useDashboardLiveUpdates";

const liveUpdateMocks = vi.hoisted(() => ({
  refreshTakenOverTranscriptNow: vi.fn(),
  scheduleSelectedAgentSessionRefresh: vi.fn(),
  scheduleTakenOverTranscriptRefresh: vi.fn(),
  useDashboardAgentSessionRefreshes: vi.fn(),
  useDashboardLiveUpdatesSocket: vi.fn(),
  useDashboardPromptReplyWatchdog: vi.fn()
}));

vi.mock("./useDashboardAgentSessionRefreshes", () => ({
  useDashboardAgentSessionRefreshes: liveUpdateMocks.useDashboardAgentSessionRefreshes
}));

vi.mock("./useDashboardLiveUpdatesSocket", () => ({
  useDashboardLiveUpdatesSocket: liveUpdateMocks.useDashboardLiveUpdatesSocket
}));

vi.mock("@modules/dashboard/model/prompt/useDashboardPromptReplyWatchdog", () => ({
  useDashboardPromptReplyWatchdog: liveUpdateMocks.useDashboardPromptReplyWatchdog
}));

const activeTakenOverAgentSessionIdRef = { current: "agent-1" };

function createStore(): DashboardStore {
  return {
    mergeActiveTakenOverAgentSessionDetail: vi.fn()
  } as unknown as DashboardStore;
}

function TestHarness({
  loadSession
}: {
  loadSession: (sessionId: string, options?: LoadOptions) => Promise<SessionDetail | null>;
}) {
  const activeTabRef = useRef<SessionTab>("overview");
  const selectedAgentSessionIdRef = useRef("agent-1");
  const selectedAgentSessionRef = useRef<AgentSessionDetail | null>(null);
  const selectedSessionIdRef = useRef("managed-1");
  const selectedSessionRef = useRef<SessionDetail | null>(null);

  useDashboardLiveUpdates({
    activeTab: "overview",
    activeTabRef,
    activeTakenOverAgentSession: null,
    activeTakenOverAgentSessionSummaryId: "agent-1",
    eventStreamAttempt: 0,
    loadSession,
    pendingChatPrompt: null as PendingChatPrompt | null,
    selectedAgentSessionId: "agent-1",
    selectedAgentSessionIdRef,
    selectedAgentSessionRef,
    selectedSession: null,
    selectedSessionId: "managed-1",
    selectedSessionIdRef,
    selectedSessionRef,
    store: createStore()
  });

  return null;
}

function setDocumentVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value
  });
}

describe("useDashboardLiveUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveUpdateMocks.useDashboardAgentSessionRefreshes.mockReturnValue({
      activeTakenOverAgentSessionIdRef,
      refreshTakenOverTranscriptNow: liveUpdateMocks.refreshTakenOverTranscriptNow,
      scheduleSelectedAgentSessionRefresh: liveUpdateMocks.scheduleSelectedAgentSessionRefresh,
      scheduleTakenOverTranscriptRefresh: liveUpdateMocks.scheduleTakenOverTranscriptRefresh
    });
    setDocumentVisibility("visible");
  });

  it("refreshes the active chat and selected managed session after mobile wake", () => {
    const loadSession = vi.fn(() => Promise.resolve(null));

    render(<TestHarness loadSession={loadSession} />);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(liveUpdateMocks.scheduleSelectedAgentSessionRefresh).toHaveBeenCalledWith(
      undefined,
      {
        reason: "mobile-resume"
      }
    );
    expect(liveUpdateMocks.refreshTakenOverTranscriptNow).toHaveBeenCalledWith(
      undefined,
      {
        allowDuringPromptPolling: true,
        reason: "mobile-resume"
      }
    );
    expect(loadSession).toHaveBeenCalledWith("managed-1", {
      silent: true,
      sessionView: "chat"
    });
  });

  it("does not refresh while the page is hidden", () => {
    const loadSession = vi.fn(() => Promise.resolve(null));
    setDocumentVisibility("hidden");

    render(<TestHarness loadSession={loadSession} />);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(liveUpdateMocks.scheduleSelectedAgentSessionRefresh).not.toHaveBeenCalled();
    expect(liveUpdateMocks.refreshTakenOverTranscriptNow).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
  });
});
