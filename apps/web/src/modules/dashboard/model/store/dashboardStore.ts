import { makeAutoObservable, observable } from "mobx";

import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionsResponse,
  AgentSessionSourceCount,
  AgentSessionSummary,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse,
  OverviewResponse,
  RuntimeSummary,
  SessionDetail,
  SessionLogLine,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { AgentSessionsLoadState } from "@models/agentSessions/contracts";
import type { AgentTranscriptHistoryProtection } from "@models/bounds/agentTranscriptBounds";
import { buildSourceCards } from "@models/dashboard/sourceCards";
import type { DashboardCache } from "@models/dashboardCache";
import { initialLiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type { SessionTab } from "@models/sessionTabs";

import { applyDashboardStoreCache } from "./dashboardStoreCache";
import type { DashboardStoreOptions } from "./dashboardStoreCache";
import { initialOverview } from "./dashboardStoreDefaults";
import {
  findActiveTakenOverAgentSessionSummary,
  formatCount,
  getActiveTakenOverAgentSessionSummaryId
} from "./helpers";
import * as agentSessionSlice from "./slices/dashboardAgentSessionSlice";
import * as liveStateSlice from "./slices/dashboardLiveStateSlice";
import * as managedDetailSlice from "./slices/dashboardManagedDetailSlice";
import {
  countRunningSessions,
  selectManagedSessions
} from "./slices/managedSessions";
import { mergeOverviewSnapshot } from "./slices/overviewState";
import { mergeAgentSessionDetail } from "./transcript/transcriptMerge";

export { initialOverview };
export type { DashboardStoreOptions };
export type { AgentSessionsLoadState } from "@models/agentSessions/contracts";

export class DashboardStore {
  hasHydrated = false;
  overview: OverviewResponse;
  agentSessions: AgentSessionSummary[];
  agentSessionsHasMore = false;
  agentSessionsLoadState: AgentSessionsLoadState = "loading";
  agentSessionsQuery: string | null = null;
  agentSessionsTotalCount = 0;
  agentSessionsTotalCountExact = true;
  agentSessionSourceCounts: AgentSessionSourceCount[] = [];
  runtimes: RuntimeSummary[];
  selectedSourceId: AgentKind | "all";
  selectedAgentSessionId: string;
  selectedAgentSession: AgentSessionDetail | null;
  readyForReviewAgentSessionIds: string[];
  isAgentSessionLoading = false;
  selectedAgentSessionRefreshNonce = 0;
  activeTakenOverAgentSession: AgentSessionDetail | null;
  isActiveTakenOverAgentSessionLoading = false;
  selectedWorkspaceId: string;
  selectedSessionId: string;
  selectedSession: SessionDetail | null;
  activeTab: SessionTab = "overview";
  workspacePath = "";
  command = "";
  previewPort = "";
  error = "";
  loading = false;
  pickingWorkspace = false;
  attachingAgentSessionId = "";
  eventStreamAttempt = 0;
  isBootstrapping = true;
  liveUpdatesConnection: LiveUpdatesConnectionState = initialLiveUpdatesConnectionState;
  overviewLiveRevision = 0;
  overviewSessionRevisionById = new Map<string, number>();
  overviewWorkspaceRevisionById = new Map<string, number>();
  agentTranscriptHistoryProtectionById = new Map<string, AgentTranscriptHistoryProtection>();

  constructor(cache: DashboardCache = {}, options?: DashboardStoreOptions) {
    this.overview = initialOverview;
    this.agentSessions = [];
    this.runtimes = [];
    this.selectedSourceId = "all";
    this.selectedAgentSessionId = "";
    this.selectedAgentSession = null;
    this.readyForReviewAgentSessionIds = [];
    this.activeTakenOverAgentSession = null;
    this.selectedWorkspaceId = "";
    this.selectedSessionId = "";
    this.selectedSession = null;
    applyDashboardStoreCache(this, cache, options);

    makeAutoObservable(
      this,
      {
        hasHydrated: false,
        overviewLiveRevision: false,
        overviewSessionRevisionById: false,
        overviewWorkspaceRevisionById: false,
        agentTranscriptHistoryProtectionById: false,
        overview: observable.ref,
        agentSessions: observable.ref,
        runtimes: observable.ref,
        selectedAgentSession: observable.ref,
        activeTakenOverAgentSession: observable.ref,
        selectedSession: observable.ref
      },
      {
        autoBind: true
      }
    );
  }

  hydrateFromCache(cache: DashboardCache, options?: DashboardStoreOptions) {
    if (this.hasHydrated) {
      return;
    }

    applyDashboardStoreCache(this, cache, options);
    this.hasHydrated = true;
  }

  resetConnectionScopedState() {
    this.hasHydrated = false;
    this.overview = initialOverview;
    this.agentSessions = [];
    this.agentSessionsHasMore = false;
    this.agentSessionsLoadState = "loading";
    this.agentSessionsQuery = null;
    this.agentSessionsTotalCount = 0;
    this.agentSessionsTotalCountExact = true;
    this.agentSessionSourceCounts = [];
    this.runtimes = [];
    this.selectedSourceId = "all";
    this.selectedAgentSessionId = "";
    this.selectedAgentSession = null;
    this.readyForReviewAgentSessionIds = [];
    this.isAgentSessionLoading = false;
    this.selectedAgentSessionRefreshNonce = 0;
    this.activeTakenOverAgentSession = null;
    this.isActiveTakenOverAgentSessionLoading = false;
    this.selectedWorkspaceId = "";
    this.selectedSessionId = "";
    this.selectedSession = null;
    this.activeTab = "overview";
    this.workspacePath = "";
    this.command = "";
    this.previewPort = "";
    this.error = "";
    this.loading = false;
    this.pickingWorkspace = false;
    this.attachingAgentSessionId = "";
    this.eventStreamAttempt += 1;
    this.isBootstrapping = true;
    this.liveUpdatesConnection = initialLiveUpdatesConnectionState;
    this.overviewLiveRevision = 0;
    this.overviewSessionRevisionById.clear();
    this.overviewWorkspaceRevisionById.clear();
    this.agentTranscriptHistoryProtectionById.clear();
  }

  get filteredAgentSessions() {
    return this.selectedSourceId === "all"
      ? this.agentSessions
      : this.agentSessions.filter((session) => session.agentId === this.selectedSourceId);
  }

  get activeTakenOverAgentSessionSummary() {
    return findActiveTakenOverAgentSessionSummary(
      this.agentSessions,
      this.overview.sessions,
      this.selectedSessionId,
      this.selectedSession
    );
  }

  get activeTakenOverAgentSessionSummaryId() {
    return getActiveTakenOverAgentSessionSummaryId(
      this.agentSessions,
      this.overview.sessions,
      this.selectedSessionId,
      this.selectedSession
    );
  }

  get managedSessions() {
    return selectManagedSessions(this.overview.sessions, this.selectedSessionId);
  }

  get runningCount() {
    return countRunningSessions(this.overview.sessions);
  }

  get sourceCards() {
    return buildSourceCards(this.agentSessions, this.agentSessionSourceCounts);
  }

  get agentSessionsTotalCountLabel() {
    if (this.agentSessionsLoadState !== "ready") {
      return "...";
    }
    return formatCount(this.agentSessionsTotalCount, this.agentSessionsTotalCountExact);
  }

  get visibleRuntimes() {
    return this.runtimes.filter((runtime) => runtime.installed || runtime.running);
  }

  captureOverviewRevision() {
    return this.overviewLiveRevision;
  }

  setOverview(value: OverviewResponse, requestRevision = this.overviewLiveRevision) {
    this.overview = mergeOverviewSnapshot(this.overview, value, {
      shouldPreserveSession: (session) =>
        (this.overviewSessionRevisionById.get(session.id) ?? 0) > requestRevision,
      shouldPreserveWorkspace: (workspace) =>
        (this.overviewWorkspaceRevisionById.get(workspace.id) ?? 0) > requestRevision
    });
    this.pruneOverviewRevisions(requestRevision);
  }

  updateOverview(updater: (current: OverviewResponse) => OverviewResponse) {
    this.overview = updater(this.overview);
  }

  mergeOverviewSession(summary: SessionSummary) {
    const previousOverview = this.overview;
    liveStateSlice.mergeOverviewSession(this, summary);
    if (this.overview !== previousOverview) {
      this.recordOverviewSessionRevision(summary.id);
    }
  }

  touchOverviewSession(sessionId: string, timestamp: string) {
    const previousOverview = this.overview;
    liveStateSlice.touchOverviewSession(this, sessionId, timestamp);
    if (this.overview !== previousOverview) {
      this.recordOverviewSessionRevision(sessionId);
    }
  }

  addWorkspaceSummary(summary: WorkspaceSummary) {
    const previousOverview = this.overview;
    liveStateSlice.addWorkspaceSummary(this, summary);
    if (this.overview !== previousOverview) {
      this.overviewLiveRevision += 1;
      this.overviewWorkspaceRevisionById.set(summary.id, this.overviewLiveRevision);
    }
  }

  setAgentSessions(value: AgentSessionSummary[]) {
    agentSessionSlice.setAgentSessions(this, value);
  }

  setAgentSessionsPage(page: AgentSessionsResponse) {
    agentSessionSlice.setAgentSessionsPage(this, page);
  }

  appendAgentSessionsPage(page: AgentSessionsResponse) {
    agentSessionSlice.appendAgentSessionsPage(this, page);
  }

  setAgentSessionsLoadState(value: AgentSessionsLoadState) {
    this.agentSessionsLoadState = value;
  }

  updateAgentSessions(updater: (current: AgentSessionSummary[]) => AgentSessionSummary[]) {
    this.agentSessions = updater(this.agentSessions);
  }

  mergeAgentSessionSummary(summary: AgentSessionSummary) {
    agentSessionSlice.mergeAgentSessionSummary(this, summary);
  }

  setRuntimes(value: RuntimeSummary[]) {
    this.runtimes = value;
  }

  setSelectedSourceId(value: AgentKind | "all") {
    this.selectedSourceId = value;
  }

  setSelectedAgentSessionId(value: string) {
    this.selectedAgentSessionId = value;
  }

  markAgentSessionReadyForReview(sessionId: string) {
    agentSessionSlice.markAgentSessionReadyForReview(this, sessionId);
  }

  clearAgentSessionReadyForReview(sessionId: string) {
    agentSessionSlice.clearAgentSessionReadyForReview(this, sessionId);
  }

  markAgentSessionReviewedAt(sessionId: string, reviewedAt: string) {
    agentSessionSlice.markAgentSessionReviewedAt(this, sessionId, reviewedAt);
  }

  setSelectedAgentSession(value: AgentSessionDetail | null) {
    this.selectedAgentSession = value && this.selectedAgentSession?.id === value.id
      ? mergeAgentSessionDetail(
          this.selectedAgentSession,
          value,
          this.agentTranscriptHistoryProtectionById.get(value.id)
        )
      : value;
  }

  updateSelectedAgentSession(
    updater: (current: AgentSessionDetail | null) => AgentSessionDetail | null
  ) {
    this.selectedAgentSession = updater(this.selectedAgentSession);
  }

  mergeSelectedAgentSessionDetail(detail: AgentSessionDetail) {
    agentSessionSlice.mergeSelectedAgentSessionDetail(this, detail);
  }

  setIsAgentSessionLoading(value: boolean) {
    this.isAgentSessionLoading = value;
  }

  incrementSelectedAgentSessionRefreshNonce() {
    this.selectedAgentSessionRefreshNonce += 1;
  }

  setActiveTakenOverAgentSession(value: AgentSessionDetail | null) {
    this.activeTakenOverAgentSession = value && this.activeTakenOverAgentSession?.id === value.id
      ? mergeAgentSessionDetail(
          this.activeTakenOverAgentSession,
          value,
          this.agentTranscriptHistoryProtectionById.get(value.id)
        )
      : value;
  }

  updateActiveTakenOverAgentSession(
    updater: (current: AgentSessionDetail | null) => AgentSessionDetail | null
  ) {
    this.activeTakenOverAgentSession = updater(this.activeTakenOverAgentSession);
  }

  mergeActiveTakenOverAgentSessionDetail(detail: AgentSessionDetail) {
    agentSessionSlice.mergeActiveTakenOverAgentSessionDetail(this, detail);
  }

  mergeFetchedAgentSessionTranscriptPage(
    sessionId: string,
    page: { entries: AgentTranscriptEntry[]; transcriptView?: AgentTranscriptViewResponse }
  ) {
    agentSessionSlice.mergeFetchedAgentSessionTranscriptPage(this, sessionId, page);
  }

  setIsActiveTakenOverAgentSessionLoading(value: boolean) {
    this.isActiveTakenOverAgentSessionLoading = value;
  }

  setSelectedWorkspaceId(value: string) {
    this.selectedWorkspaceId = value;
  }

  setSelectedSessionId(value: string) {
    this.selectedSessionId = value;
  }

  setSelectedSession(value: SessionDetail | null) {
    managedDetailSlice.setSelectedSession(this, value);
  }

  mergeSelectedSessionView(
    value: SessionDetail,
    view: managedDetailSlice.ManagedSessionDetailView
  ) {
    managedDetailSlice.mergeSelectedSessionView(this, value, view);
  }

  updateSelectedSession(updater: (current: SessionDetail | null) => SessionDetail | null) {
    this.selectedSession = updater(this.selectedSession);
  }

  mergeSelectedSessionSummary(summary: SessionSummary, options?: { includePreview?: boolean }) {
    managedDetailSlice.mergeSelectedSessionSummary(this, summary, options);
  }

  appendSelectedSessionLog(sessionId: string, log: SessionLogLine) {
    this.appendSelectedSessionLogs(sessionId, [log]);
  }

  appendSelectedSessionLogs(sessionId: string, logs: SessionLogLine[]) {
    managedDetailSlice.appendSelectedSessionLogs(this, sessionId, logs);
  }

  setActiveTab(value: SessionTab) {
    this.activeTab = value;
  }

  setWorkspacePath(value: string) {
    this.workspacePath = value;
  }

  setCommand(value: string) {
    this.command = value;
  }

  setPreviewPort(value: string) {
    this.previewPort = value;
  }

  setError(value: string) {
    this.error = value;
  }

  updateError(updater: (current: string) => string) {
    this.error = updater(this.error);
  }

  setErrorIfEmpty(value: string) {
    this.error = this.error || value;
  }

  clearLiveUpdatesReconnectError() {
    liveStateSlice.clearLiveUpdatesReconnectError(this);
  }

  setLiveUpdatesConnecting() {
    liveStateSlice.setLiveUpdatesConnecting(this);
  }

  markLiveUpdatesSynced(syncedAt = new Date().toISOString()) {
    liveStateSlice.markLiveUpdatesSynced(this, syncedAt);
  }

  setLiveUpdatesReconnecting() {
    liveStateSlice.setLiveUpdatesReconnecting(this);
  }

  setLiveUpdatesOffline() {
    liveStateSlice.setLiveUpdatesOffline(this);
  }

  setLoading(value: boolean) {
    this.loading = value;
  }

  setPickingWorkspace(value: boolean) {
    this.pickingWorkspace = value;
  }

  setAttachingAgentSessionId(value: string) {
    this.attachingAgentSessionId = value;
  }

  incrementEventStreamAttempt() {
    this.eventStreamAttempt += 1;
  }

  setIsBootstrapping(value: boolean) {
    this.isBootstrapping = value;
  }

  private recordOverviewSessionRevision(sessionId: string) {
    this.overviewLiveRevision += 1;
    this.overviewSessionRevisionById.set(sessionId, this.overviewLiveRevision);
  }

  private pruneOverviewRevisions(requestRevision: number) {
    for (const [sessionId, revision] of this.overviewSessionRevisionById) {
      if (revision <= requestRevision) {
        this.overviewSessionRevisionById.delete(sessionId);
      }
    }
    for (const [workspaceId, revision] of this.overviewWorkspaceRevisionById) {
      if (revision <= requestRevision) {
        this.overviewWorkspaceRevisionById.delete(workspaceId);
      }
    }
  }
}

export const dashboardStore = new DashboardStore();
