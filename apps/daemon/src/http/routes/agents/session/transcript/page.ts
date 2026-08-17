import type { AgentSessionDetail, AgentTranscriptEntry } from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import { summarizeAgentSessionTranscript } from "../../../../transcript/agentTranscriptSummary.ts";
import { buildAgentTranscriptView } from "../../../../transcript/agentTranscriptView.ts";

const MAX_AGENT_SESSION_TRANSCRIPT_PAGE_WINDOW_ENTRY_IDS = 2000;

export function isChatTranscriptEntry(entry: AgentTranscriptEntry) {
  return entry.role === "user" || entry.role === "assistant";
}

function readTranscriptEntryLineIndex(entryId: string) {
  const separatorIndex = entryId.lastIndexOf("-");
  if (separatorIndex < 0) {
    return null;
  }

  const parsed = Number(entryId.slice(separatorIndex + 1));
  return Number.isInteger(parsed) ? parsed : null;
}

export function buildTranscriptPage(
  session: AgentSessionDetail,
  beforeEntryId: string,
  limit: number
) {
  const beforeEntryLineIndex = readTranscriptEntryLineIndex(beforeEntryId);
  const chatEntries = session.transcript.filter(isChatTranscriptEntry);
  const beforeChatIndex = chatEntries.findIndex((entry) => entry.id === beforeEntryId);
  const fallbackBeforeChatIndex = beforeEntryLineIndex === null
    ? -1
    : chatEntries.findIndex((entry) => {
        const lineIndex = readTranscriptEntryLineIndex(entry.id);
        return lineIndex !== null && lineIndex >= beforeEntryLineIndex;
      });
  const effectiveBeforeChatIndex = beforeChatIndex >= 0
    ? beforeChatIndex
    : fallbackBeforeChatIndex >= 0
      ? fallbackBeforeChatIndex
      : chatEntries.length;

  const startChatIndex = Math.max(0, effectiveBeforeChatIndex - limit);
  const pageChatEntries = chatEntries.slice(startChatIndex, effectiveBeforeChatIndex);
  const firstPageLineIndex = readTranscriptEntryLineIndex(pageChatEntries[0]?.id ?? "") ?? 0;
  const lastPageLineIndex =
    readTranscriptEntryLineIndex(pageChatEntries[pageChatEntries.length - 1]?.id ?? "") ??
    (beforeEntryLineIndex ?? Number.MAX_SAFE_INTEGER);
  const entries = session.transcript.filter((entry) => {
    const lineIndex = readTranscriptEntryLineIndex(entry.id);
    return lineIndex !== null && lineIndex >= firstPageLineIndex && lineIndex <= lastPageLineIndex;
  });

  const pageSession = { ...session, transcript: entries };
  return {
    entries,
    hasMore: startChatIndex > 0,
    transcriptView: buildAgentTranscriptView(summarizeAgentSessionTranscript(pageSession))
  };
}

async function buildTranscriptPageResponse({
  agentSessionId,
  entries,
  hasMore,
  sourceAgentSessions
}: {
  agentSessionId: string;
  entries: AgentTranscriptEntry[];
  hasMore: boolean;
  sourceAgentSessions: SourceAgentSessionService;
}) {
  const metadataSession = await sourceAgentSessions.getSessionDetail(
    agentSessionId,
    false,
    undefined,
    1
  );
  if (!metadataSession) {
    return null;
  }

  const pageSession = {
    ...sourceAgentSessions.reconcileAttachedSession(metadataSession),
    transcript: entries
  };
  return {
    entries,
    hasMore,
    transcriptView: buildAgentTranscriptView(summarizeAgentSessionTranscript(pageSession))
  };
}

function buildTranscriptPageFromWindow(
  entries: AgentTranscriptEntry[],
  beforeEntryId: string,
  beforeEntryLineIndex: number,
  limit: number,
  windowStartLineIndex: number
) {
  const sortedEntries = [...entries].sort((left, right) =>
    (readTranscriptEntryLineIndex(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (readTranscriptEntryLineIndex(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
  const entriesBeforeTarget = sortedEntries.filter((entry) => {
    const lineIndex = readTranscriptEntryLineIndex(entry.id);
    return lineIndex !== null && lineIndex < beforeEntryLineIndex;
  });
  const chatEntries = entriesBeforeTarget.filter(isChatTranscriptEntry);
  const beforeChatIndex = chatEntries.findIndex((entry) => entry.id === beforeEntryId) >= 0
    ? chatEntries.findIndex((entry) => entry.id === beforeEntryId)
    : chatEntries.length;
  const startChatIndex = Math.max(0, beforeChatIndex - limit);
  const pageChatEntries = chatEntries.slice(startChatIndex, beforeChatIndex);
  const firstPageLineIndex = readTranscriptEntryLineIndex(pageChatEntries[0]?.id ?? "");
  const lastPageLineIndex = readTranscriptEntryLineIndex(
    pageChatEntries[pageChatEntries.length - 1]?.id ?? ""
  );

  if (firstPageLineIndex === null || lastPageLineIndex === null) {
    return { entries: [], hasMore: windowStartLineIndex > 0 };
  }

  return {
    entries: entriesBeforeTarget.filter((entry) => {
      const lineIndex = readTranscriptEntryLineIndex(entry.id);
      return lineIndex !== null && lineIndex >= firstPageLineIndex && lineIndex <= lastPageLineIndex;
    }),
    hasMore: windowStartLineIndex > 0 || startChatIndex > 0
  };
}

function readTranscriptEntryIdPrefix(entryId: string) {
  const separatorIndex = entryId.lastIndexOf("-");
  return separatorIndex < 0 ? null : entryId.slice(0, separatorIndex + 1);
}

export async function buildBoundedTranscriptPageFromExactEntries({
  agentSessionId,
  beforeEntryId,
  limit,
  sourceAgentSessions
}: {
  agentSessionId: string;
  beforeEntryId: string;
  limit: number;
  sourceAgentSessions: SourceAgentSessionService;
}) {
  const beforeEntryLineIndex = readTranscriptEntryLineIndex(beforeEntryId);
  const entryIdPrefix = readTranscriptEntryIdPrefix(beforeEntryId);
  if (beforeEntryLineIndex === null || entryIdPrefix === null) {
    return null;
  }

  const windowStartLineIndex = Math.max(
    0,
    beforeEntryLineIndex - MAX_AGENT_SESSION_TRANSCRIPT_PAGE_WINDOW_ENTRY_IDS
  );
  const entryIds = Array.from(
    { length: beforeEntryLineIndex - windowStartLineIndex },
    (_item, index) => `${entryIdPrefix}${windowStartLineIndex + index}`
  );
  if (entryIds.length === 0) {
    return null;
  }

  const windowEntries = await sourceAgentSessions.getTranscriptEntries(agentSessionId, entryIds);
  if (windowEntries.length === 0) {
    return null;
  }

  const page = buildTranscriptPageFromWindow(
    windowEntries,
    beforeEntryId,
    beforeEntryLineIndex,
    limit,
    windowStartLineIndex
  );
  if (page.entries.length === 0) {
    return null;
  }

  return buildTranscriptPageResponse({
    agentSessionId,
    entries: page.entries,
    hasMore: page.hasMore,
    sourceAgentSessions
  });
}

function buildTranscriptPageFromPreviousWindow(
  entries: AgentTranscriptEntry[],
  limit: number,
  hasOlderSourceWindow: boolean
) {
  const sortedEntries = [...entries].sort((left, right) =>
    (readTranscriptEntryLineIndex(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (readTranscriptEntryLineIndex(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
  const chatEntries = sortedEntries.filter(isChatTranscriptEntry);
  const startChatIndex = Math.max(0, chatEntries.length - limit);
  const pageChatEntries = chatEntries.slice(startChatIndex);
  const firstPageLineIndex = readTranscriptEntryLineIndex(pageChatEntries[0]?.id ?? "");
  const lastPageLineIndex = readTranscriptEntryLineIndex(
    pageChatEntries[pageChatEntries.length - 1]?.id ?? ""
  );

  if (firstPageLineIndex === null || lastPageLineIndex === null) {
    return { entries: [], hasMore: hasOlderSourceWindow };
  }

  return {
    entries: sortedEntries.filter((entry) => {
      const lineIndex = readTranscriptEntryLineIndex(entry.id);
      return lineIndex !== null && lineIndex >= firstPageLineIndex && lineIndex <= lastPageLineIndex;
    }),
    hasMore: hasOlderSourceWindow || startChatIndex > 0
  };
}

export async function buildTranscriptPageFromPreviousSourceWindow({
  agentSessionId,
  beforeEntryId,
  limit,
  sourceAgentSessions
}: {
  agentSessionId: string;
  beforeEntryId: string;
  limit: number;
  sourceAgentSessions: SourceAgentSessionService;
}) {
  const previousWindow = await sourceAgentSessions.getTranscriptPreviousWindow(
    agentSessionId,
    { beforeEntryId }
  );
  if (!previousWindow) {
    return null;
  }

  const page = buildTranscriptPageFromPreviousWindow(
    previousWindow.entries,
    limit,
    previousWindow.hasMore
  );
  if (page.entries.length === 0) {
    return null;
  }

  return buildTranscriptPageResponse({
    agentSessionId,
    entries: page.entries,
    hasMore: page.hasMore,
    sourceAgentSessions
  });
}

export function hasPreviousTranscriptSourceWindow(entryId: string) {
  const windowSeparatorIndex = entryId.lastIndexOf("@");
  const lineSeparatorIndex = entryId.lastIndexOf("-");
  if (windowSeparatorIndex < 0 || lineSeparatorIndex <= windowSeparatorIndex) {
    return false;
  }

  const windowRange = entryId.slice(windowSeparatorIndex + 1, lineSeparatorIndex);
  const byteOffset = Number(windowRange.split("~", 1)[0]);
  return Number.isSafeInteger(byteOffset) && byteOffset > 0;
}
