import {
  buildAgentChatDetailFetchOptions
} from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";
import type { AgentChatDetailFetchResult } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";

import { hasDetailAtLeastAsFreshAs } from "./agentChatDetailState";
import type { AgentChatDetailLoadOptions } from "./agentChatDetailTypes";

type DetailRequestCacheEntry = {
  cachedAt: number;
  result: AgentChatDetailFetchResult;
};

function isRequestKeyForSession(requestKey: string, sessionId: string) {
  try {
    return (JSON.parse(requestKey) as { agentSessionId?: unknown }).agentSessionId === sessionId;
  } catch {
    return requestKey.startsWith(`${sessionId}:`);
  }
}

export class AgentChatDetailCache {
  private readonly entries = new Map<string, DetailRequestCacheEntry>();
  private readonly requestStartedAtByKey = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly ttlMs: number,
    private readonly now: () => number
  ) {}

  buildRequestKey(agentSessionId: string, options: AgentChatDetailLoadOptions) {
    const fetchOptions = buildAgentChatDetailFetchOptions(options);
    return JSON.stringify({
      agentSessionId,
      chatMessageTail: fetchOptions.chatMessageTail ?? null,
      fullTranscript: fetchOptions.fullTranscript === true,
      includeTranscriptView: fetchOptions.includeTranscriptView === true,
      omitTranscript: fetchOptions.omitTranscript === true,
      transcriptDetail: fetchOptions.transcriptDetail ?? null,
      transcriptTail: fetchOptions.transcriptTail ?? null,
      waitingSince: fetchOptions.waitingSince ?? null
    });
  }

  readFresh(requestKey: string, options: AgentChatDetailLoadOptions) {
    const cached = this.entries.get(requestKey);
    if (!cached) {
      return null;
    }
    if (this.now() - cached.cachedAt > this.ttlMs) {
      this.entries.delete(requestKey);
      return null;
    }
    if (
      options.minimumUpdatedAt && cached.result.detail &&
      !hasDetailAtLeastAsFreshAs(
        cached.result.detail,
        cached.result.detail.id,
        options.minimumUpdatedAt
      )
    ) {
      return null;
    }
    this.entries.delete(requestKey);
    this.entries.set(requestKey, cached);
    return cached.result;
  }

  set(requestKey: string, result: AgentChatDetailFetchResult) {
    if (!result.detail) {
      this.entries.delete(requestKey);
      return;
    }
    this.entries.delete(requestKey);
    this.entries.set(requestKey, { cachedAt: this.now(), result });
    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }

  readLastRequestStartedAt(requestKey: string) {
    return this.requestStartedAtByKey.get(requestKey);
  }

  rememberRequestStartedAt(requestKey: string) {
    this.requestStartedAtByKey.set(requestKey, this.now());
  }

  clearSession(sessionId: string) {
    for (const key of this.entries.keys()) {
      if (isRequestKeyForSession(key, sessionId)) {
        this.entries.delete(key);
      }
    }
    for (const key of this.requestStartedAtByKey.keys()) {
      if (isRequestKeyForSession(key, sessionId)) {
        this.requestStartedAtByKey.delete(key);
      }
    }
  }

  clear() {
    this.entries.clear();
    this.requestStartedAtByKey.clear();
  }
}
