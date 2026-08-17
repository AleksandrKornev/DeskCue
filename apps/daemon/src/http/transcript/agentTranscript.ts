import type { AgentSessionDetail } from "@deskcue/protocol";

function isAtOrAfterTime(timestamp: string, baselineTime: number | null) {
  if (baselineTime === null) {
    return true;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed >= baselineTime;
}

function isRetainedTranscriptMetaEntry(phase: string | null) {
  return phase === "context_compacted" || phase === "model_changed";
}

function readFirstChatEntryTime(entries: AgentSessionDetail["transcript"]) {
  const firstChatEntry = entries.find((entry) => entry.role === "user" || entry.role === "assistant");
  if (!firstChatEntry) {
    return null;
  }

  const parsed = Date.parse(firstChatEntry.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

export function trimAgentSessionTranscript(session: AgentSessionDetail, transcriptTail: number | null) {
  if (!transcriptTail || session.transcript.length <= transcriptTail) {
    return session;
  }

  const tailEntries = session.transcript.slice(-transcriptTail);
  const tailEntryIds = new Set(tailEntries.map((entry) => entry.id));
  const firstTailChatTime = readFirstChatEntryTime(tailEntries);
  const retainedMetaEntries = session.transcript.filter(
    (entry) =>
      isRetainedTranscriptMetaEntry(entry.phase) &&
      !tailEntryIds.has(entry.id) &&
      isAtOrAfterTime(entry.timestamp, firstTailChatTime)
  );

  return {
    ...session,
    transcript: [...retainedMetaEntries, ...tailEntries]
  };
}
