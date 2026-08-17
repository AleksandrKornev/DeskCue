import type { CodexTranscriptEntry, CodexTranscriptRole, TranscriptPart } from "@deskcue/protocol";

export function createCodexTranscriptEntry(
  sessionId: string,
  index: number,
  timestamp: string,
  role: CodexTranscriptRole,
  text: string,
  phase: string | null,
  parts?: TranscriptPart[]
) {
  return {
    id: `${sessionId}-${index}`,
    timestamp,
    role,
    text,
    phase,
    parts
  } satisfies CodexTranscriptEntry;
}
