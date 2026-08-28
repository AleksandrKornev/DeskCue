import type {
  AgentSessionSourceVersion,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

const DEFAULT_TRANSCRIPT_VIEW_CACHE_LIMIT = 32;
const DEFAULT_TRANSCRIPT_VIEW_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TRANSCRIPT_VIEW_CACHE_MAX_ITEM_BYTES = 768 * 1024;
const DEFAULT_TRANSCRIPT_ENTRY_MISS_CACHE_LIMIT = 4000;

export type TranscriptViewCacheKeyOptions = {
  chatMessageTail: number | null;
  fullTranscript: boolean;
  transcriptDetail: "full" | "summary";
  transcriptTail: number | null;
  waitingSince: string | null;
};

type TranscriptViewCacheEntry = {
  bytes: number;
  transcriptEntryCount: number;
  view: AgentTranscriptViewResponse;
};

type TranscriptEntriesReadResult = {
  cachedMissCount: number;
  entries: AgentTranscriptEntry[];
  readEntryCount: number;
};

type AgentTranscriptHttpCacheOptions = {
  entryMissLimit?: number;
  viewItemMaxBytes?: number;
  viewMaxBytes?: number;
  viewSizeLimit?: number;
};

function buildTranscriptEntryMissCacheKey(
  agentSessionId: string,
  sourceVersion: string,
  entryId: string
) {
  return [agentSessionId, sourceVersion, entryId].join("\u0000");
}

function estimateJsonBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function omitTranscriptViewSession(
  view: AgentTranscriptViewResponse
): AgentTranscriptViewResponse {
  const { session: _session, ...cachedView } = view;

  return cachedView;
}

export class AgentTranscriptHttpCache {
  private readonly entryMissLimit: number;
  private readonly entryMisses = new Map<string, true>();
  private readonly viewItemMaxBytes: number;
  private readonly viewMaxBytes: number;
  private readonly views = new Map<string, TranscriptViewCacheEntry>();
  private readonly viewSizeLimit: number;
  private viewBytes = 0;

  constructor({
    entryMissLimit = DEFAULT_TRANSCRIPT_ENTRY_MISS_CACHE_LIMIT,
    viewItemMaxBytes = DEFAULT_TRANSCRIPT_VIEW_CACHE_MAX_ITEM_BYTES,
    viewMaxBytes = DEFAULT_TRANSCRIPT_VIEW_CACHE_MAX_BYTES,
    viewSizeLimit = DEFAULT_TRANSCRIPT_VIEW_CACHE_LIMIT
  }: AgentTranscriptHttpCacheOptions = {}) {
    this.entryMissLimit = entryMissLimit;
    this.viewItemMaxBytes = viewItemMaxBytes;
    this.viewMaxBytes = viewMaxBytes;
    this.viewSizeLimit = viewSizeLimit;
  }

  reset() {
    this.views.clear();
    this.viewBytes = 0;
    this.entryMisses.clear();
  }

  readView(key: string) {
    const cached = this.views.get(key);

    if (!cached) return null;

    this.views.delete(key);
    this.views.set(key, cached);
    return cached;
  }

  setView(
    key: string,
    view: AgentTranscriptViewResponse,
    transcriptEntryCount: number
  ) {
    const cachedView = omitTranscriptViewSession(view);
    const bytes = estimateJsonBytes(cachedView);

    if (bytes > this.viewItemMaxBytes) {
      this.deleteView(key);
      return;
    }

    this.deleteView(key);
    this.views.set(key, {
      bytes,
      transcriptEntryCount,
      view: cachedView
    });
    this.viewBytes += bytes;

    while (
      this.views.size > this.viewSizeLimit ||
      this.viewBytes > this.viewMaxBytes
    ) {
      const oldestKey = this.views.keys().next().value;

      if (oldestKey === undefined) return;

      this.deleteView(oldestKey);
    }
  }

  async readEntries(
    sourceAgentSessions: SourceAgentSessionService,
    agentSessionId: string,
    entryIds: string[],
    sourceVersion: AgentSessionSourceVersion | null
  ): Promise<TranscriptEntriesReadResult> {
    const normalizedEntryIds = Array.from(new Set(
      entryIds.map((entryId) => entryId.trim()).filter(Boolean)
    ));

    if (!sourceVersion) {
      return {
        cachedMissCount: 0,
        entries: await sourceAgentSessions.getTranscriptEntries(
          agentSessionId,
          normalizedEntryIds
        ),
        readEntryCount: normalizedEntryIds.length
      };
    }

    const entryIdsToRead = normalizedEntryIds.filter((entryId) =>
      !this.entryMisses.has(buildTranscriptEntryMissCacheKey(
        agentSessionId,
        sourceVersion.sourceVersion,
        entryId
      ))
    );
    const cachedMissCount = normalizedEntryIds.length - entryIdsToRead.length;
    const entries = entryIdsToRead.length > 0
      ? await sourceAgentSessions.getTranscriptEntries(agentSessionId, entryIdsToRead)
      : [];
    const returnedEntryIds = new Set(entries.map((entry) => entry.id));

    for (const entryId of entryIdsToRead) {
      const cacheKey = buildTranscriptEntryMissCacheKey(
        agentSessionId,
        sourceVersion.sourceVersion,
        entryId
      );

      if (returnedEntryIds.has(entryId)) {
        this.entryMisses.delete(cacheKey);
        continue;
      }

      this.setEntryMiss(cacheKey);
    }

    return {
      cachedMissCount,
      entries,
      readEntryCount: entryIdsToRead.length
    };
  }

  private deleteView(key: string) {
    const existing = this.views.get(key);

    if (!existing) return;

    this.views.delete(key);
    this.viewBytes = Math.max(0, this.viewBytes - existing.bytes);
  }

  private setEntryMiss(key: string) {
    if (this.entryMisses.has(key)) this.entryMisses.delete(key);

    this.entryMisses.set(key, true);

    while (this.entryMisses.size > this.entryMissLimit) {
      const oldestKey = this.entryMisses.keys().next().value;

      if (oldestKey === undefined) return;

      this.entryMisses.delete(oldestKey);
    }
  }
}

export function buildTranscriptViewCacheKey(
  version: AgentSessionSourceVersion,
  options: TranscriptViewCacheKeyOptions
) {
  return JSON.stringify({
    agentSessionId: version.summary.id,
    chatMessageTail: options.chatMessageTail,
    fullTranscript: options.fullTranscript,
    localStateVersion: version.localStateVersion ?? null,
    sourceVersion: version.sourceVersion,
    transcriptDetail: options.transcriptDetail,
    transcriptTail: options.transcriptTail,
    waitingSince: options.waitingSince
  });
}

export function shouldCacheTranscriptViewForSourceVersion(
  version: AgentSessionSourceVersion
) {
  return version.summary.workState !== "running";
}
