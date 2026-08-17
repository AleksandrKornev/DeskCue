import type {
  AgentSessionDetail,
  AgentSessionSummary,
  OverviewResponse,
  RuntimeSummary,
  SessionDetail,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { trimSessionDetailForCache } from "@models/bounds/sessionDetailBounds";
import type { DashboardCache } from "@models/dashboardCache";

function hasMeaningfulOverview(overview: OverviewResponse | undefined) {
  if (!overview) {
    return false;
  }

  return overview.workspaces.length > 0 || overview.sessions.length > 0;
}

function hasItems<T>(items: T[] | undefined) {
  return Boolean(items && items.length > 0);
}

function shouldPreservePromptState(incoming: DashboardCache) {
  return Boolean(
    !incoming.selectedSession &&
      !incoming.selectedSessionId &&
      !hasMeaningfulOverview(incoming.overview) &&
      !hasItems(incoming.agentSessions)
  );
}

function hasOwnCacheKey<TKey extends keyof DashboardCache>(
  value: DashboardCache,
  key: TKey
) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function trimCachedAgentSession(session: AgentSessionDetail | null) {
  if (!session) {
    return null;
  }

  return {
    ...session,
    transcript: [],
    transcriptView: undefined
  };
}

export function mergeDashboardCache(existing: DashboardCache, incoming: DashboardCache): DashboardCache {
  const preservePromptState = shouldPreservePromptState(incoming);
  const hasIncomingSelectedAgentSessionId = hasOwnCacheKey(incoming, "selectedAgentSessionId");
  const hasIncomingSelectedSessionId = hasOwnCacheKey(incoming, "selectedSessionId");
  const hasIncomingSelectedSession = hasOwnCacheKey(incoming, "selectedSession");

  return {
    overview:
      hasMeaningfulOverview(incoming.overview) || !hasMeaningfulOverview(existing.overview)
        ? incoming.overview
        : existing.overview,
    agentSessions:
      hasItems(incoming.agentSessions) || !hasItems(existing.agentSessions)
        ? incoming.agentSessions
        : existing.agentSessions,
    runtimes:
      hasItems(incoming.runtimes) || !hasItems(existing.runtimes)
        ? incoming.runtimes
        : existing.runtimes,
    selectedSourceId: incoming.selectedSourceId ?? existing.selectedSourceId,
    selectedAgentSessionId: hasIncomingSelectedAgentSessionId
      ? incoming.selectedAgentSessionId ?? ""
      : existing.selectedAgentSessionId ?? "",
    selectedAgentSession: null,
    readyForReviewAgentSessionIds:
      incoming.readyForReviewAgentSessionIds ?? existing.readyForReviewAgentSessionIds ?? [],
    activeTakenOverAgentSession:
      trimCachedAgentSession(
        incoming.activeTakenOverAgentSession ?? existing.activeTakenOverAgentSession ?? null
      ),
    selectedWorkspaceId: incoming.selectedWorkspaceId || existing.selectedWorkspaceId || "",
    selectedSessionId: hasIncomingSelectedSessionId
      ? incoming.selectedSessionId ?? ""
      : existing.selectedSessionId ?? "",
    selectedSession: hasIncomingSelectedSession
      ? incoming.selectedSession ?? null
      : existing.selectedSession ?? null,
    pendingChatPrompt:
      incoming.pendingChatPrompt ??
      (preservePromptState ? existing.pendingChatPrompt ?? null : null),
    awaitingChatReplySince:
      incoming.awaitingChatReplySince ??
      (preservePromptState ? existing.awaitingChatReplySince ?? null : null),
    isWaitingForChatReply: preservePromptState
      ? incoming.pendingChatPrompt || incoming.awaitingChatReplySince || incoming.isWaitingForChatReply
        ? incoming.isWaitingForChatReply ?? false
        : existing.isWaitingForChatReply ?? false
      : incoming.isWaitingForChatReply ?? false
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isWorkspaceSummaryLike(value: unknown): value is WorkspaceSummary {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.path === "string" &&
      typeof value.isGitRepo === "boolean" &&
      isNullableString(value.branch) &&
      typeof value.createdAt === "string"
  );
}

function isSessionStatus(value: unknown) {
  return value === "running" || value === "read_only" || value === "stopped" ||
    value === "done" || value === "failed";
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isReplyPhase(value: unknown) {
  return value === "idle" || value === "queued" || value === "sending" || value === "waiting";
}

function isPromptRecoveryStateLike(value: unknown) {
  return Boolean(
    isRecord(value) &&
      (value.phase === "checking" || value.phase === "outcome_unknown" || value.phase === "not_sent") &&
      isNullableString(value.promptText) &&
      typeof value.requestedAt === "string" &&
      typeof value.retryable === "boolean"
  );
}

function isSessionActionRequestLike(value: unknown) {
  return Boolean(
    isRecord(value) &&
      value.kind === "approval" &&
      isNullableString(value.command) &&
      isNullableString(value.reason) &&
      typeof value.requestedAt === "string"
  );
}

function isSessionSummaryLike(value: unknown): value is SessionSummary {
  if (!isRecord(value) || !isRecord(value.preview) || !isRecord(value.replyState) || !isRecord(value.git)) {
    return false;
  }
  return Boolean(
    typeof value.id === "string" &&
      typeof value.workspaceId === "string" &&
      typeof value.workspaceName === "string" &&
      typeof value.adapterId === "string" &&
      isNullableString(value.sourceSessionId) &&
      typeof value.command === "string" &&
      isSessionStatus(value.status) &&
      typeof value.startedAt === "string" &&
      isNullableString(value.finishedAt) &&
      typeof value.lastActivityAt === "string" &&
      (value.exitCode === null || isSafeInteger(value.exitCode)) &&
      (value.preview.port === null ||
        (isSafeInteger(value.preview.port) &&
          value.preview.port >= 1 &&
          value.preview.port <= 65_535)) &&
      typeof value.preview.active === "boolean" &&
      isNullableString(value.preview.targetUrl) &&
      (value.preview.networkMode === "device-direct" || value.preview.networkMode === "deskcue-host") &&
      isReplyPhase(value.replyState.phase) &&
      isNullableString(value.replyState.promptText) &&
      isNullableString(value.replyState.requestedAt) &&
      typeof value.git.isGitRepo === "boolean" &&
      isNullableString(value.git.branch) &&
      typeof value.git.isDirty === "boolean" &&
      Array.isArray(value.git.changedFiles) &&
      value.git.changedFiles.every((path) => typeof path === "string") &&
      typeof value.git.diff === "string" &&
      typeof value.git.lastUpdatedAt === "string" &&
      (value.promptRecovery === undefined || value.promptRecovery === null ||
        isPromptRecoveryStateLike(value.promptRecovery)) &&
      (value.actionRequest === undefined || value.actionRequest === null ||
        isSessionActionRequestLike(value.actionRequest)) &&
      (value.viewerCount === undefined ||
        (isSafeInteger(value.viewerCount) && value.viewerCount >= 0)) &&
      (value.canSendInput === undefined || typeof value.canSendInput === "boolean") &&
      (value.inputBlockedReason === undefined || isNullableString(value.inputBlockedReason))
  );
}

function isOverviewResponseLike(value: unknown): value is OverviewResponse {
  return Boolean(
    isRecord(value) &&
      isRecord(value.clientContext) &&
      typeof value.clientContext.canOpenNativeDialogs === "boolean" &&
      Array.isArray(value.workspaces) &&
      value.workspaces.every(isWorkspaceSummaryLike) &&
      Array.isArray(value.sessions) &&
      value.sessions.every(isSessionSummaryLike)
  );
}

function isAgentSessionSummaryLike(value: unknown): value is AgentSessionSummary {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      (value.agentId === "codex" || value.agentId === "claude-code" || value.agentId === "other") &&
      typeof value.agentLabel === "string" &&
      typeof value.sourceSessionId === "string" &&
      typeof value.title === "string" &&
      isNullableString(value.workspacePath) &&
      isNullableString(value.workspaceName) &&
      typeof value.updatedAt === "string" &&
      isNullableString(value.model) &&
      isNullableString(value.originator) &&
      isNullableString(value.cliVersion) &&
      isNullableString(value.source) &&
      typeof value.filePath === "string" &&
      (value.attachMode === "resume" || value.attachMode === "read_only") &&
      (value.workState === "idle" || value.workState === "running")
  );
}

function isRuntimeSummaryLike(value: unknown): value is RuntimeSummary {
  return Boolean(
    isRecord(value) &&
      (value.id === "ollama" || value.id === "lm-studio" || value.id === "codex" || value.id === "claude-code") &&
      typeof value.label === "string" &&
      typeof value.installed === "boolean" &&
      typeof value.running === "boolean" &&
      isNullableString(value.endpoint) &&
      typeof value.modelCount === "number" &&
      typeof value.loadedModelCount === "number" &&
      isNullableString(value.lastActiveModel) &&
      typeof value.statusText === "string"
  );
}

function isAgentKindOrAll(value: unknown) {
  return value === "all" || value === "codex" || value === "claude-code" || value === "other";
}

function isAgentSessionDetailLike(
  value: unknown
): value is AgentSessionDetail {
  return Boolean(
    isRecord(value) &&
      isAgentSessionSummaryLike(value) &&
      Array.isArray(value.transcript)
  );
}

function isSessionLogLineLike(value: unknown) {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.timestamp === "string" &&
      (value.stream === "stdout" || value.stream === "stderr" || value.stream === "system") &&
      typeof value.text === "string"
  );
}

function isSessionDetailLike(value: unknown): value is SessionDetail {
  return Boolean(
    isRecord(value) &&
      isSessionSummaryLike(value) &&
      Array.isArray(value.logs) &&
      value.logs.every(isSessionLogLineLike) &&
      Array.isArray(value.inputHistory) &&
      value.inputHistory.every((input) => typeof input === "string")
  );
}

function isPendingChatPromptLike(value: unknown): value is NonNullable<DashboardCache["pendingChatPrompt"]> {
  return Boolean(
    isRecord(value) &&
      typeof value.text === "string" &&
      typeof value.requestedAt === "string"
  );
}

export function sanitizeDashboardCache(value: unknown): DashboardCache {
  const cache = isRecord(value) ? value : {};
  return {
    overview: isOverviewResponseLike(cache.overview) ? cache.overview : undefined,
    agentSessions: Array.isArray(cache.agentSessions)
      ? cache.agentSessions.filter(isAgentSessionSummaryLike)
      : [],
    runtimes: Array.isArray(cache.runtimes)
      ? cache.runtimes.filter(isRuntimeSummaryLike)
      : [],
    selectedSourceId: isAgentKindOrAll(cache.selectedSourceId)
      ? cache.selectedSourceId
      : undefined,
    selectedAgentSessionId: typeof cache.selectedAgentSessionId === "string"
      ? cache.selectedAgentSessionId
      : undefined,
    // The selected detail is always rehydrated by id. Caching it without transcript
    // makes the browser preview treat a stale shell as a real empty transcript.
    selectedAgentSession: null,
    activeTakenOverAgentSession: isAgentSessionDetailLike(cache.activeTakenOverAgentSession)
      ? trimCachedAgentSession(cache.activeTakenOverAgentSession)
      : null,
    selectedSession: isSessionDetailLike(cache.selectedSession)
      ? trimSessionDetailForCache(cache.selectedSession)
      : null,
    readyForReviewAgentSessionIds: Array.isArray(cache.readyForReviewAgentSessionIds)
      ? cache.readyForReviewAgentSessionIds.filter((sessionId) => typeof sessionId === "string").slice(0, 50)
      : [],
    selectedWorkspaceId: typeof cache.selectedWorkspaceId === "string"
      ? cache.selectedWorkspaceId
      : undefined,
    selectedSessionId: typeof cache.selectedSessionId === "string"
      ? cache.selectedSessionId
      : undefined,
    pendingChatPrompt: isPendingChatPromptLike(cache.pendingChatPrompt) ? cache.pendingChatPrompt : null,
    awaitingChatReplySince:
      typeof cache.awaitingChatReplySince === "string" ? cache.awaitingChatReplySince : null,
    isWaitingForChatReply: cache.isWaitingForChatReply === true
  };
}
