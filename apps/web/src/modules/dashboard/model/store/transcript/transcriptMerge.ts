import type {
  AgentSessionDetail,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse
} from "@deskcue/protocol";
import type { AgentTranscriptHistoryProtection } from "@models/bounds/agentTranscriptBounds";
import {
  boundLiveTranscriptEntries,
  boundLiveTranscriptView,
  boundTranscriptEntriesWithHistory,
  boundTranscriptViewWithHistory
} from "@models/bounds/agentTranscriptBounds";

import { areInterruptLifecyclesEqual } from "./transcriptMergeIdentity";
import { mergeAgentTranscriptEntries } from "./transcriptTimelineMerge";
import {
  mergeAgentTranscriptView,
  mergeAgentTranscriptViewPage
} from "./transcriptViewMerge";

export function mergeContextCompactionCount(
  current: number | undefined,
  next: number | undefined
) {
  if (current === undefined) {
    return next;
  }

  if (next === undefined) {
    return current;
  }

  return Math.max(current, next);
}

export function mergeAgentSessionDetail(
  current: AgentSessionDetail | null,
  next: AgentSessionDetail,
  historyProtection?: AgentTranscriptHistoryProtection
) {
  if (!current || current.id !== next.id) {
    return next;
  }

  const mergedTranscript = mergeAgentTranscriptEntries(current.transcript, next.transcript);
  const transcript = historyProtection
    ? boundTranscriptEntriesWithHistory(mergedTranscript, historyProtection.entryIds)
    : boundLiveTranscriptEntries(mergedTranscript);
  const currentLastTranscriptId = current.transcript[current.transcript.length - 1]?.id ?? null;
  const nextLastTranscriptId = transcript[transcript.length - 1]?.id ?? null;
  const mergedTranscriptView = next.transcriptView
    ? mergeAgentTranscriptView(current.transcriptView, next.transcriptView)
    : current.transcriptView;
  const transcriptView = historyProtection
    ? boundTranscriptViewWithHistory(mergedTranscriptView, historyProtection.viewItemKeys)
    : boundLiveTranscriptView(mergedTranscriptView);
  const transcriptViewUnchanged =
    next.transcriptView === undefined ||
    current.transcriptView === transcriptView;
  const transcriptUnchanged =
    current.updatedAt === next.updatedAt &&
    current.transcript.length === transcript.length &&
    currentLastTranscriptId === nextLastTranscriptId &&
    transcriptViewUnchanged &&
    areInterruptLifecyclesEqual(current, next);

  const contextCompactionCount = mergeContextCompactionCount(
    current.contextCompactionCount,
    next.contextCompactionCount
  );
  // Discovery can briefly produce a partial snapshot without a model while it
  // is reading the source transcript. Do not make a known model disappear from
  // the active chat header just because that partial snapshot won the race.
  const model = next.model ?? current.model;
  const nextDetail =
    contextCompactionCount === next.contextCompactionCount && model === next.model
      ? next
      : {
          ...next,
          contextCompactionCount,
          model
        };

  return transcriptUnchanged ? current : { ...nextDetail, transcript, transcriptView };
}

export function mergeAgentSessionTranscriptPage(
  current: AgentSessionDetail | null,
  sessionId: string,
  page: { entries: AgentTranscriptEntry[]; transcriptView?: AgentTranscriptViewResponse },
  historyProtection?: AgentTranscriptHistoryProtection
) {
  if (!current || current.id !== sessionId || page.entries.length === 0) {
    return current;
  }

  return {
    ...current,
    transcript: historyProtection
      ? boundTranscriptEntriesWithHistory(
          mergeAgentTranscriptEntries(current.transcript, page.entries),
          historyProtection.entryIds
        )
      : boundLiveTranscriptEntries(mergeAgentTranscriptEntries(current.transcript, page.entries)),
    transcriptView: historyProtection
      ? boundTranscriptViewWithHistory(
          mergeAgentTranscriptViewPage(current.transcriptView, page.transcriptView),
          historyProtection.viewItemKeys
        )
      : boundLiveTranscriptView(
          mergeAgentTranscriptViewPage(current.transcriptView, page.transcriptView)
        )
  };
}
