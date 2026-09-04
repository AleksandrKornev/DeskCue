import type { AgentSessionDetail, AgentSessionSourceVersion } from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import { buildLightweightTranscriptDelta } from "./deltaProjection.ts";
import { reconcileSourceWindowSession, toAgentSessionSummary } from "./sessionProjection.ts";
import {
  doesTranscriptViewItemReferenceSourceEntry,
  doesTranscriptWindowReferenceSourceEntry
} from "./sourceRefs.ts";
import { summarizeAgentSessionTranscript } from "../../../../../transcript/agentTranscriptSummary.ts";
import { buildAgentTranscriptView } from "../../../../../transcript/agentTranscriptView.ts";
import { transcriptHttpCache } from "../hydration/projectionCache.ts";
import { hydrateTranscriptViewWaitingDetailEntry } from "../hydration/waitingDetailHydration.ts";

const LIGHTWEIGHT_TRANSCRIPT_UPDATES_OVERLAP_LINE_COUNT = 96;

// Keep one source window through a realistically dense active turn. Re-anchoring
// after a short tail makes Codex source entry IDs change and remounts the live UI.
const LIGHTWEIGHT_TRANSCRIPT_UPDATES_MAX_LINE_COUNT = 16_384;

type SourceWindowProjectionOptions = {
  agentSessionId: string;
  chatMessageTail: number | null;
  fullTranscript: boolean;
  sourceAgentSessions: SourceAgentSessionService;
  sourceVersion: AgentSessionSourceVersion | null;
  transcriptDetail: "full" | "summary";
  transcriptTail: number | null;
  waitingSince: string | null;
};

async function buildHydratedTranscriptView({
  agentSessionId,
  session,
  sourceAgentSessions,
  sourceVersion,
  waitingSince
}: {
  agentSessionId: string;
  session: AgentSessionDetail;
  sourceAgentSessions: SourceAgentSessionService;
  sourceVersion: AgentSessionSourceVersion;
  waitingSince: string | null;
}) {
  return hydrateTranscriptViewWaitingDetailEntry({
    agentSessionId,
    sourceAgentSessions,
    sourceVersion,
    transcriptHttpCache,
    transcriptView: buildAgentTranscriptView(
      summarizeAgentSessionTranscript(session),
      { waitingSince }
    )
  });
}

function buildReconciledWindowSession(
  sourceAgentSessions: SourceAgentSessionService,
  sourceVersion: AgentSessionSourceVersion,
  transcript: AgentSessionDetail["transcript"],
  syncReplyState: boolean
) {
  const windowSession: AgentSessionDetail = {
    ...sourceVersion.summary,
    transcript
  };

  if (syncReplyState) {
    sourceAgentSessions.syncReplyStateFromAgentSession(windowSession);
  }

  return reconcileSourceWindowSession(sourceAgentSessions, windowSession);
}

export async function tryBuildTranscriptViewFromSourceTailWindow({
  agentSessionId,
  chatMessageTail,
  fullTranscript,
  sourceAgentSessions,
  sourceVersion,
  transcriptDetail,
  transcriptTail,
  waitingSince
}: SourceWindowProjectionOptions) {
  if (
    !sourceVersion ||
    transcriptDetail !== "summary" ||
    fullTranscript ||
    transcriptTail !== null ||
    chatMessageTail === null
  ) {
    return null;
  }

  const readTranscriptTailWindow = sourceAgentSessions.getTranscriptTailWindow?.bind(
    sourceAgentSessions
  );

  if (!readTranscriptTailWindow) {
    return null;
  }

  const transcriptWindow = await readTranscriptTailWindow(agentSessionId, { chatMessageTail });

  if (!transcriptWindow?.length) {
    return null;
  }

  const reconciledWindowSession = buildReconciledWindowSession(
    sourceAgentSessions,
    sourceVersion,
    transcriptWindow,
    true
  );
  const transcriptView = await buildHydratedTranscriptView({
    agentSessionId,
    session: reconciledWindowSession,
    sourceAgentSessions,
    sourceVersion,
    waitingSince
  });

  return {
    sessionSummary: toAgentSessionSummary(reconciledWindowSession),
    transcriptEntryCount: transcriptWindow.length,
    transcriptView
  };
}

// Initial source-version summaries can omit a model that the bounded exact-ID
// reader can recover. Enrich only that initial header projection.
export async function enrichTranscriptViewSourceVersionSummary({
  agentSessionId,
  chatMessageTail,
  includeSessionSummary,
  sourceAgentSessions,
  sourceVersion,
  transcriptTail
}: {
  agentSessionId: string;
  chatMessageTail: number | null;
  includeSessionSummary: boolean;
  sourceAgentSessions: SourceAgentSessionService;
  sourceVersion: AgentSessionSourceVersion | null;
  transcriptTail: number | null;
}) {
  if (!includeSessionSummary || !sourceVersion || sourceVersion.summary.model) {
    return sourceVersion;
  }

  const detail = await sourceAgentSessions.getSessionDetail(
    agentSessionId,
    false,
    transcriptTail ?? undefined,
    chatMessageTail ?? undefined,
    { lightweight: "bounded-exact-ids" }
  );

  if (!detail?.model) {
    return sourceVersion;
  }

  sourceAgentSessions.syncReplyStateFromAgentSession(detail);
  return {
    ...sourceVersion,
    summary: toAgentSessionSummary(sourceAgentSessions.reconcileAttachedSession(detail))
  };
}

export async function tryBuildTranscriptUpdatesFromSourceTailWindow({
  agentSessionId,
  baseItemKey,
  baseSourceEntryId,
  chatMessageTail,
  fullTranscript,
  includeSessionSummary,
  overlapItemCount,
  sourceAgentSessions,
  sourceVersion,
  transcriptDetail,
  transcriptTail,
  waitingSince
}: SourceWindowProjectionOptions & {
  baseItemKey: string | null;
  baseSourceEntryId: string | null;
  includeSessionSummary: boolean;
  overlapItemCount: number;
}) {
  if (
    !sourceVersion ||
    transcriptDetail !== "summary" ||
    fullTranscript ||
    includeSessionSummary ||
    transcriptTail !== null ||
    chatMessageTail === null ||
    !baseItemKey
  ) {
    return null;
  }

  const readTranscriptTailWindow = sourceAgentSessions.getTranscriptTailWindow?.bind(
    sourceAgentSessions
  );

  if (!readTranscriptTailWindow) {
    return null;
  }

  const transcriptWindow = await readTranscriptTailWindow(agentSessionId, { chatMessageTail });

  if (!transcriptWindow?.length) {
    return null;
  }

  const windowSession = buildReconciledWindowSession(
    sourceAgentSessions,
    sourceVersion,
    transcriptWindow,
    true
  );
  const transcriptView = await buildHydratedTranscriptView({
    agentSessionId,
    session: windowSession,
    sourceAgentSessions,
    sourceVersion,
    waitingSince
  });
  const baseItemIndex = transcriptView.items.findIndex((item) =>
    item.key === baseItemKey ||
    Boolean(baseSourceEntryId && doesTranscriptViewItemReferenceSourceEntry(item, baseSourceEntryId))
  );
  const delta = baseItemIndex >= 0
    ? buildLightweightTranscriptDelta(
        transcriptView,
        baseItemIndex,
        baseItemKey,
        overlapItemCount
      )
    : {
        ...transcriptView,
        replaceFromItemKey: null
      };

  return {
    delta,
    items: delta.items,
    replaceFromItemKey: delta.replaceFromItemKey,
    transcriptEntryCount: transcriptWindow.length
  };
}

export async function tryBuildLightweightTranscriptUpdates({
  agentSessionId,
  baseItemKey,
  baseSourceEntryId,
  fullTranscript,
  includeSessionSummary,
  overlapItemCount,
  sourceAgentSessions,
  sourceVersion,
  transcriptDetail,
  transcriptTail,
  waitingSince
}: Omit<SourceWindowProjectionOptions, "chatMessageTail"> & {
  baseItemKey: string | null;
  baseSourceEntryId: string | null;
  includeSessionSummary: boolean;
  overlapItemCount: number;
}) {
  if (
    !sourceVersion ||
    transcriptDetail !== "summary" ||
    fullTranscript ||
    includeSessionSummary ||
    transcriptTail !== null ||
    !baseItemKey ||
    !baseSourceEntryId
  ) {
    return null;
  }

  const transcriptWindow = await sourceAgentSessions.getTranscriptWindow?.(agentSessionId, {
    baseSourceEntryId,
    maxLineCount: LIGHTWEIGHT_TRANSCRIPT_UPDATES_MAX_LINE_COUNT,
    overlapLineCount: LIGHTWEIGHT_TRANSCRIPT_UPDATES_OVERLAP_LINE_COUNT
  });

  if (
    !transcriptWindow?.length ||
    !doesTranscriptWindowReferenceSourceEntry(transcriptWindow, baseSourceEntryId)
  ) {
    return null;
  }

  const windowSession = buildReconciledWindowSession(
    sourceAgentSessions,
    sourceVersion,
    transcriptWindow,
    false
  );
  const transcriptView = await buildHydratedTranscriptView({
    agentSessionId,
    session: windowSession,
    sourceAgentSessions,
    sourceVersion,
    waitingSince
  });
  const baseItemIndex = transcriptView.items.findIndex((item) =>
    item.key === baseItemKey ||
    doesTranscriptViewItemReferenceSourceEntry(item, baseSourceEntryId)
  );

  if (baseItemIndex < 0) {
    return null;
  }

  const matchedBaseItem = transcriptView.items[baseItemIndex];

  if (matchedBaseItem?.type === "message" && matchedBaseItem.key !== baseItemKey) {
    return null;
  }

  const delta = buildLightweightTranscriptDelta(
    transcriptView,
    baseItemIndex,
    baseItemKey,
    overlapItemCount
  );

  return {
    delta,
    items: delta.items,
    replaceFromItemKey: delta.replaceFromItemKey,
    transcriptEntryCount: transcriptWindow.length
  };
}
