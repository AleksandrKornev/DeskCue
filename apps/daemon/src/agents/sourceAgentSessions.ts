import type {
  AgentKind,
  AgentSessionDetail,
  AgentSessionIndexSnapshotMeta,
  AgentSessionSourceVersion,
  AgentSessionsResponse,
  AgentSessionSourceCount,
  AgentSessionSummary,
  AgentTranscriptEntry,
  WorkspaceSummary
} from "@deskcue/protocol";

import {
  buildAgentSessionId,
  getSourceAgentDescriptor,
  parseAgentSessionId,
  sourceAgentDescriptors,
  toCodexAgentSessionSummary
} from "./sourceAgentRegistry.ts";
import type { SourceAgentLightweightMode } from "./sourceAgentRegistry.ts";
import type { SourceAgentSessionIndex } from "./sourceAgentSessionIndex.ts";

type DescriptorSessionLists = AgentSessionSummary[][];
type DescriptorSessionListsRead = {
  indexSnapshot: AgentSessionIndexSnapshotMeta;
  sessions: DescriptorSessionLists;
};
export type { SourceAgentLightweightMode };

const SOURCE_AGENT_COUNT_SCAN_LIMIT = 1000;

function readDescriptorSessionLists({
  force,
  includeLiveMetadata,
  limit,
  workspaces
}: {
  force: boolean;
  includeLiveMetadata: boolean;
  limit: number;
  workspaces: WorkspaceSummary[];
}) {
  return Promise.all(
    sourceAgentDescriptors.map((descriptor) =>
      descriptor.listSessions({
        force,
        includeLiveMetadata,
        limit,
        workspaces
      })
    )
  );
}

async function readLiveDescriptorSessionLists({
  force,
  includeLiveMetadata,
  limit,
  workspaces
}: {
  force: boolean;
  includeLiveMetadata: boolean;
  limit: number;
  workspaces: WorkspaceSummary[];
}): Promise<DescriptorSessionListsRead> {
  const sessions = await readDescriptorSessionLists({
    force,
    includeLiveMetadata,
    limit,
    workspaces
  });

  return {
    indexSnapshot: {
      ageMs: null,
      cachedAt: null,
      readMode: "live",
      refreshing: false,
      sessionCount: sessions.reduce((count, list) => count + list.length, 0),
      storage: "none"
    },
    sessions
  };
}

function buildCountScanCacheKey(workspaces: WorkspaceSummary[]) {
  return [
    SOURCE_AGENT_COUNT_SCAN_LIMIT,
    ...workspaces
      .map((workspace) => workspace.path)
      .sort()
  ].join("\u0000");
}

function readIndexedDescriptorSessionLists({
  force,
  limit,
  workspaces,
  sessionIndex
}: {
  force: boolean;
  limit: number;
  workspaces: WorkspaceSummary[];
  sessionIndex: SourceAgentSessionIndex;
}): Promise<DescriptorSessionListsRead> {
  const cacheKey = buildCountScanCacheKey(workspaces);
  return sessionIndex.readSnapshot({
    cacheKey,
    force,
    refresh: () =>
      readDescriptorSessionLists({
        force,
        includeLiveMetadata: false,
        limit,
        workspaces
      })
  });
}

export async function getAgentSessionDetail(
  agentSessionId: string,
  force = false,
  transcriptTail?: number,
  chatMessageTail?: number,
  options: {
    lightweight?: SourceAgentLightweightMode;
  } = {}
): Promise<AgentSessionDetail | null> {
  const parsed = parseAgentSessionId(agentSessionId);
  if (!parsed) {
    return null;
  }

  return getSourceAgentDescriptor(parsed.agentId)?.getSessionDetail(
    parsed.sourceSessionId,
    {
      force,
      chatMessageTail,
      lightweight: options.lightweight,
      transcriptTail
    }
  ) ?? null;
}

export async function getAgentSessionVersion(
  agentSessionId: string,
  force = false
): Promise<AgentSessionSourceVersion | null> {
  const parsed = parseAgentSessionId(agentSessionId);
  if (!parsed) {
    return null;
  }

  return getSourceAgentDescriptor(parsed.agentId)?.getSessionVersion?.(
    parsed.sourceSessionId,
    { force }
  ) ?? null;
}

export async function getAgentSessionTranscriptEntries(
  agentSessionId: string,
  entryIds: string[],
  force = false
): Promise<AgentTranscriptEntry[]> {
  const parsed = parseAgentSessionId(agentSessionId);
  if (!parsed || entryIds.length === 0) {
    return [];
  }

  const descriptor = getSourceAgentDescriptor(parsed.agentId);
  if (!descriptor) {
    return [];
  }

  if (descriptor.transcript?.getEntries) {
    return descriptor.transcript.getEntries(parsed.sourceSessionId, entryIds, { force });
  }
  return [];
}

export async function getAgentSessionTranscriptWindow(
  agentSessionId: string,
  options: {
    baseSourceEntryId: string;
    force?: boolean;
    maxLineCount?: number;
    overlapLineCount?: number;
  }
): Promise<AgentTranscriptEntry[] | null> {
  const parsed = parseAgentSessionId(agentSessionId);
  if (!parsed) {
    return null;
  }

  return getSourceAgentDescriptor(parsed.agentId)?.transcript?.getWindow?.(
    parsed.sourceSessionId,
    {
      baseSourceEntryId: options.baseSourceEntryId,
      force: options.force ?? false,
      maxLineCount: options.maxLineCount,
      overlapLineCount: options.overlapLineCount
    }
  ) ?? null;
}

export async function getAgentSessionTranscriptTailWindow(
  agentSessionId: string,
  options: {
    chatMessageTail?: number;
    force?: boolean;
  } = {}
): Promise<AgentTranscriptEntry[] | null> {
  const parsed = parseAgentSessionId(agentSessionId);
  if (!parsed) {
    return null;
  }

  return getSourceAgentDescriptor(parsed.agentId)?.transcript?.getTailWindow?.(
    parsed.sourceSessionId,
    {
      chatMessageTail: options.chatMessageTail,
      force: options.force ?? false
    }
  ) ?? null;
}

export async function getAgentSessionTranscriptPreviousWindow(
  agentSessionId: string,
  options: {
    beforeEntryId: string;
    force?: boolean;
  }
): Promise<{ entries: AgentTranscriptEntry[]; hasMore: boolean } | null> {
  const parsed = parseAgentSessionId(agentSessionId);
  if (!parsed) {
    return null;
  }

  return getSourceAgentDescriptor(parsed.agentId)?.transcript?.getPreviousWindow?.(
    parsed.sourceSessionId,
    {
      beforeEntryId: options.beforeEntryId,
      force: options.force ?? false
    }
  ) ?? null;
}

function normalizeAgentSessionQuery(query: string | null | undefined) {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  return normalizedQuery || null;
}

function matchesAgentSessionQuery(session: AgentSessionSummary, query: string | null) {
  if (!query) {
    return true;
  }

  return [
    session.id,
    session.sourceSessionId,
    session.title,
    session.workspaceName,
    session.workspacePath,
    session.agentLabel,
    session.model,
    session.source,
    session.filePath,
    session.approvalPolicy,
    session.sandboxMode
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function buildSourceCounts(
  sessions: AgentSessionSummary[],
  countLimit: number
): AgentSessionSourceCount[] {
  const countsByAgent = new Map<AgentSessionSummary["agentId"], number>();
  for (const session of sessions) {
    countsByAgent.set(session.agentId, (countsByAgent.get(session.agentId) ?? 0) + 1);
  }

  return Array.from(countsByAgent.entries()).map(([agentId, count]) => ({
    agentId,
    count,
    exact: count < countLimit
  }));
}

export async function listAgentSessionPage(
  sessionIndex: SourceAgentSessionIndex,
  limit = 50,
  workspaces: WorkspaceSummary[] = [],
  options: {
    force?: boolean;
    includeLiveMetadata?: boolean;
    offset?: number;
    query?: string | null;
    sourceId?: AgentKind | null;
  } = {}
): Promise<AgentSessionsResponse> {
  const normalizedLimit = Math.max(1, limit);
  const offset = Math.max(0, options.offset ?? 0);
  const query = normalizeAgentSessionQuery(options.query);
  const sourceId = options.sourceId ?? null;
  const discoveryLimit = query
    ? SOURCE_AGENT_COUNT_SCAN_LIMIT
    : Math.min(SOURCE_AGENT_COUNT_SCAN_LIMIT, offset + normalizedLimit + 1);
  // Keep one canonical bounded discovery snapshot per workspace set. Including
  // pagination offsets in the cache key duplicated the same summaries many
  // times and let memory grow with browsing depth.
  const countLimit = SOURCE_AGENT_COUNT_SCAN_LIMIT;
  const force = options.force ?? false;
  const includeLiveMetadataForDiscovery = query
    ? false
    : options.includeLiveMetadata ?? false;
  const discoveredSessionsPromise = includeLiveMetadataForDiscovery
    ? readLiveDescriptorSessionLists({
        force,
        includeLiveMetadata: includeLiveMetadataForDiscovery,
        limit: discoveryLimit,
        workspaces
      })
    : readIndexedDescriptorSessionLists({
        force,
        limit: countLimit,
        workspaces,
        sessionIndex
      });
  const canReuseDiscoveredSessionsForCount = !includeLiveMetadataForDiscovery;
  const countSessionsPromise = canReuseDiscoveredSessionsForCount
    ? discoveredSessionsPromise
    : readIndexedDescriptorSessionLists({
        force,
        limit: countLimit,
        workspaces,
        sessionIndex
      });
  const [discoveredSessionsRead, countSessionsRead] = await Promise.all([
    discoveredSessionsPromise,
    countSessionsPromise
  ]);
  const discoveredSessions = discoveredSessionsRead.sessions;
  const countSessions = countSessionsRead.sessions;

  const matchingCountSessions = countSessions
    .flat()
    .filter((session) => matchesAgentSessionQuery(session, query));
  const matchingSourceSessions = sourceId
    ? matchingCountSessions.filter((session) => session.agentId === sourceId)
    : matchingCountSessions;
  const sourceCounts = buildSourceCounts(matchingCountSessions, countLimit);
  const totalCount = matchingCountSessions.length;
  const totalCountExact = sourceCounts.every((sourceCount) => sourceCount.exact);

  const matchingSessions = discoveredSessions
    .flat()
    .filter((session) => matchesAgentSessionQuery(session, query))
    .filter((session) => !sourceId || session.agentId === sourceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return {
    sessions: matchingSessions.slice(offset, offset + normalizedLimit),
    limit: normalizedLimit,
    offset,
    hasMore: matchingSourceSessions.length > offset + normalizedLimit,
    query,
    totalCount,
    totalCountExact,
    sourceCounts,
    indexSnapshot: countSessionsRead.indexSnapshot
  };
}

export async function listAgentSessions(
  sessionIndex: SourceAgentSessionIndex,
  limit = 50,
  workspaces: WorkspaceSummary[] = [],
  options: {
    force?: boolean;
    includeLiveMetadata?: boolean;
  } = {}
): Promise<AgentSessionSummary[]> {
  const page = await listAgentSessionPage(sessionIndex, limit, workspaces, options);
  return page.sessions;
}

export {
  buildAgentSessionId,
  parseAgentSessionId,
  toCodexAgentSessionSummary
};
