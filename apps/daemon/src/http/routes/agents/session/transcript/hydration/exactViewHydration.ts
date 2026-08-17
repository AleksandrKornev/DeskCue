import type { AgentSessionDetail, AgentSessionSourceVersion } from "@deskcue/protocol";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";

import { hydrateTranscriptViewWaitingDetailEntry } from "./waitingDetailHydration.ts";
import { trimAgentSessionTranscript } from "../../../../../transcript/agentTranscript.ts";
import type { AgentTranscriptHttpCache } from "../../../../../transcript/agentTranscriptHttpCache.ts";
import { summarizeAgentSessionTranscript } from "../../../../../transcript/agentTranscriptSummary.ts";
import { buildAgentTranscriptView } from "../../../../../transcript/agentTranscriptView.ts";
import { readAgentSessionDetailReadMode } from "../view/projection.ts";

type ReadBoundedExactTranscriptSessionOptions = {
  agentSessionId: string;
  chatMessageTail: number | null;
  sourceAgentSessions: SourceAgentSessionService;
  transcriptTail: number | null;
};

type HydrateBoundedExactTranscriptViewOptions = {
  agentSessionId: string;
  responseSession: AgentSessionDetail;
  sourceAgentSessions: SourceAgentSessionService;
  sourceVersion: AgentSessionSourceVersion | null;
  transcriptDetail: "full" | "summary";
  transcriptHttpCache: AgentTranscriptHttpCache;
  waitingSince: string | null;
};

export async function readBoundedExactTranscriptSession({
  agentSessionId,
  chatMessageTail,
  sourceAgentSessions,
  transcriptTail
}: ReadBoundedExactTranscriptSessionOptions) {
  const session = await sourceAgentSessions.getSessionDetail(
    agentSessionId,
    false,
    transcriptTail ?? undefined,
    chatMessageTail ?? undefined,
    {
      lightweight: "bounded-exact-ids"
    }
  );
  if (!session) return null;

  sourceAgentSessions.syncReplyStateFromAgentSession(session);
  const responseSession = trimAgentSessionTranscript(
    sourceAgentSessions.reconcileAttachedSession(session),
    transcriptTail
  );

  return {
    detailReadMode: readAgentSessionDetailReadMode(session),
    responseSession
  };
}

export function hydrateBoundedExactTranscriptView({
  agentSessionId,
  responseSession,
  sourceAgentSessions,
  sourceVersion,
  transcriptDetail,
  transcriptHttpCache,
  waitingSince
}: HydrateBoundedExactTranscriptViewOptions) {
  const viewSession =
    transcriptDetail === "summary"
      ? summarizeAgentSessionTranscript(responseSession)
      : responseSession;

  return hydrateTranscriptViewWaitingDetailEntry({
    agentSessionId,
    sourceAgentSessions,
    sourceVersion,
    transcriptHttpCache,
    transcriptView: buildAgentTranscriptView(viewSession, { waitingSince })
  });
}
