import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgentSessionDetail, SessionSummary } from "@deskcue/protocol";

import { useDashboardRouteViewModel } from "./useDashboardRouteViewModel";

describe("useDashboardRouteViewModel session recovery", () => {
  it("keeps a missing route session focused for its recovery surface", () => {
    const { result } = renderHook(() => useDashboardRouteViewModel({
      activeTakenOverAgentSession: null,
      attachingAgentSessionId: "",
      initialManagedSessionLoadState: { kind: "missing" },
      isActiveTakenOverAgentSessionLoading: false,
      isAgentBrowserListMode: false,
      isAgentSessionLoading: false,
      isBootstrapping: false,
      isDashboardPinned: false,
      managedSessions: [],
      openingAgentSessionId: "",
      overviewSessions: [],
      routeState: {
        agentSessionId: "",
        kind: "session",
        overlay: null,
        sessionId: "route-session",
        sourceId: "all",
        tab: "overview"
      },
      selectedAgentSession: null,
      selectedAgentSessionId: "",
      selectedSession: null,
      selectedSessionId: "route-session",
      selectedSourceId: "all"
    }));

    expect(result.current.effectiveSelectedSessionId).toBe("route-session");
    expect(result.current.hasManagedFocus).toBe(true);
    expect(result.current.showBootstrapShell).toBe(false);
  });

  it("does not auto-promote a subagent source chat into its attached managed session", () => {
    const attachedSession = {
      adapterId: "codex",
      id: "managed-child",
      replyState: { phase: "waiting" },
      sourceSessionId: "child",
      status: "running"
    } as SessionSummary;
    const selectedSubagent = {
      id: "codex:child",
      sourceSessionId: "child",
      subagent: {
        depth: 1,
        nickname: "Scout",
        parentSessionId: "codex:parent",
        role: "reviewer"
      }
    } as AgentSessionDetail;
    const { result } = renderHook(() => useDashboardRouteViewModel({
      activeTakenOverAgentSession: null,
      attachingAgentSessionId: "",
      initialManagedSessionLoadState: { kind: "loaded" },
      isActiveTakenOverAgentSessionLoading: false,
      isAgentBrowserListMode: false,
      isAgentSessionLoading: false,
      isBootstrapping: false,
      isDashboardPinned: true,
      managedSessions: [attachedSession],
      openingAgentSessionId: "",
      overviewSessions: [attachedSession],
      routeState: {
        agentSessionId: "codex:child",
        kind: "dashboard",
        overlay: null,
        sessionId: "",
        sourceId: "codex",
        tab: "overview"
      },
      selectedAgentSession: selectedSubagent,
      selectedAgentSessionId: "codex:child",
      selectedSession: null,
      selectedSessionId: "",
      selectedSourceId: "codex"
    }));

    expect(result.current.effectiveSelectedAgentSessionId).toBe("codex:child");
    expect(result.current.effectiveSelectedSessionId).toBe("");
    expect(result.current.hasManagedFocus).toBe(false);
  });

  it("does not auto-promote an unresolved source chat during initial hydration", () => {
    const attachedSession = {
      adapterId: "codex",
      id: "managed-child",
      replyState: { phase: "waiting" },
      sourceSessionId: "child",
      status: "running"
    } as SessionSummary;
    const { result } = renderHook(() => useDashboardRouteViewModel({
      activeTakenOverAgentSession: null,
      attachingAgentSessionId: "",
      initialManagedSessionLoadState: { kind: "loaded" },
      isActiveTakenOverAgentSessionLoading: false,
      isAgentBrowserListMode: false,
      isAgentSessionLoading: true,
      isBootstrapping: false,
      isDashboardPinned: true,
      managedSessions: [attachedSession],
      openingAgentSessionId: "",
      overviewSessions: [attachedSession],
      routeState: {
        agentSessionId: "codex:child",
        kind: "dashboard",
        overlay: null,
        sessionId: "",
        sourceId: "codex",
        tab: "overview"
      },
      selectedAgentSession: null,
      selectedAgentSessionId: "codex:child",
      selectedSession: null,
      selectedSessionId: "",
      selectedSourceId: "codex"
    }));

    expect(result.current.effectiveSelectedSessionId).toBe("");
    expect(result.current.hasManagedFocus).toBe(false);
  });

  it("does not match a managed session from another adapter with the same source id", () => {
    const claudeSession = {
      adapterId: "claude-code",
      id: "managed-claude",
      replyState: { phase: "waiting" },
      sourceSessionId: "shared",
      status: "running"
    } as SessionSummary;
    const selectedCodexSession = {
      agentId: "codex",
      id: "codex:shared",
      sourceSessionId: "shared"
    } as AgentSessionDetail;
    const { result } = renderHook(() => useDashboardRouteViewModel({
      activeTakenOverAgentSession: null,
      attachingAgentSessionId: "",
      initialManagedSessionLoadState: { kind: "loaded" },
      isActiveTakenOverAgentSessionLoading: false,
      isAgentBrowserListMode: false,
      isAgentSessionLoading: false,
      isBootstrapping: false,
      isDashboardPinned: true,
      managedSessions: [claudeSession],
      openingAgentSessionId: "",
      overviewSessions: [claudeSession],
      routeState: {
        agentSessionId: "codex:shared",
        kind: "dashboard",
        overlay: null,
        sessionId: "",
        sourceId: "codex",
        tab: "overview"
      },
      selectedAgentSession: selectedCodexSession,
      selectedAgentSessionId: "codex:shared",
      selectedSession: null,
      selectedSessionId: "",
      selectedSourceId: "codex"
    }));

    expect(result.current.attachedManagedSessionId).toBeNull();
    expect(result.current.effectiveSelectedSessionId).toBe("");
  });

  it("does not project another adapter's source detail into a managed session panel", () => {
    const codexManagedSession = {
      adapterId: "codex",
      id: "managed-codex",
      replyState: { phase: "idle" },
      sourceSessionId: "shared",
      status: "read_only"
    } as SessionSummary;
    const claudeSourceDetail = {
      agentId: "claude-code",
      id: "claude-code:shared",
      sourceSessionId: "shared"
    } as AgentSessionDetail;
    const { result } = renderHook(() => useDashboardRouteViewModel({
      activeTakenOverAgentSession: claudeSourceDetail,
      attachingAgentSessionId: "",
      initialManagedSessionLoadState: { kind: "loaded" },
      isActiveTakenOverAgentSessionLoading: false,
      isAgentBrowserListMode: false,
      isAgentSessionLoading: false,
      isBootstrapping: false,
      isDashboardPinned: false,
      managedSessions: [codexManagedSession],
      openingAgentSessionId: "",
      overviewSessions: [codexManagedSession],
      routeState: {
        agentSessionId: "claude-code:shared",
        kind: "session",
        overlay: null,
        sessionId: "managed-codex",
        sourceId: "all",
        tab: "overview"
      },
      selectedAgentSession: claudeSourceDetail,
      selectedAgentSessionId: "claude-code:shared",
      selectedSession: null,
      selectedSessionId: "managed-codex",
      selectedSourceId: "all"
    }));

    expect(result.current.takenOverAgentSessionForPanel).toBeNull();
  });
});
