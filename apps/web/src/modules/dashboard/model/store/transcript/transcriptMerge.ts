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

import { areAgentSessionSummariesEqual } from "./transcriptMergeIdentity";
import { mergeAgentTranscriptEntries } from "./transcriptTimelineMerge";
import {
  mergeAgentTranscriptView,
  mergeAgentTranscriptViewPage
} from "./transcriptViewMerge";

function shouldRetainTerminalSourceLifecycle(
  current: AgentSessionDetail,
  next: AgentSessionDetail
) {
  const currentTurnState = current.turnState;
  const nextTurnState = next.turnState;

  if (
    !currentTurnState ||
    currentTurnState.phase === "active" ||
    !nextTurnState ||
    nextTurnState.phase !== "active"
  ) {
    return false;
  }

  if (
    currentTurnState.fingerprint &&
    currentTurnState.fingerprint === nextTurnState.fingerprint
  ) {
    return true;
  }

  const currentCompletedAt = Date.parse(currentTurnState.completedAt ?? "");
  const nextStartedAt = Date.parse(nextTurnState.startedAt ?? nextTurnState.activityAt ?? "");

  return Number.isFinite(currentCompletedAt) &&
    Number.isFinite(nextStartedAt) &&
    nextStartedAt <= currentCompletedAt;
}

function retainTerminalSourceLifecycle(
  current: AgentSessionDetail,
  next: AgentSessionDetail
): AgentSessionDetail {
  if (!shouldRetainTerminalSourceLifecycle(current, next)) return next;

  return {
    ...next,
    turnState: current.turnState,
    workState: current.workState
  };
}

export function mergeContextCompactionCount(
  current: number | undefined,
  next: number | undefined
) {
  if (current === undefined) return next;
  if (next === undefined) return current;

  return Math.max(current, next);
}

export function mergeAgentSessionDetail(
  current: AgentSessionDetail | null,
  next: AgentSessionDetail,
  historyProtection?: AgentTranscriptHistoryProtection
) {
  if (!current || current.id !== next.id) return next;

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
  const contextCompactionCount = mergeContextCompactionCount(
    current.contextCompactionCount,
    next.contextCompactionCount
  );

  // Discovery can briefly produce a partial snapshot without a model while it
  // is reading the source transcript. Do not make a known model disappear from
  // the active chat header just because that partial snapshot won the race.
  const model = next.model ?? current.model;
  const normalizedNextDetail =
    contextCompactionCount === next.contextCompactionCount && model === next.model
      ? next
      : {
          ...next,
          contextCompactionCount,
          model
        };
  const nextDetail = retainTerminalSourceLifecycle(current, normalizedNextDetail);
  const transcriptViewUnchanged =
    next.transcriptView === undefined ||
    current.transcriptView === transcriptView;
  const transcriptUnchanged =
    areAgentSessionSummariesEqual(current, nextDetail) &&
    current.transcript.length === transcript.length &&
    currentLastTranscriptId === nextLastTranscriptId &&
    transcriptViewUnchanged;

  return transcriptUnchanged ? current : { ...nextDetail, transcript, transcriptView };
}

export function mergeAgentSessionTranscriptPage(
  current: AgentSessionDetail | null,
  sessionId: string,
  page: { entries: AgentTranscriptEntry[]; transcriptView?: AgentTranscriptViewResponse },
  historyProtection?: AgentTranscriptHistoryProtection
) {
  if (!current || current.id !== sessionId || page.entries.length === 0) return current;

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
