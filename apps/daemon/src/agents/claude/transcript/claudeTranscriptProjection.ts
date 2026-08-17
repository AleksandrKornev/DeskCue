import type { AgentTranscriptEntry } from "@deskcue/protocol";

export type ClaudeTranscriptTailOptions = {
  chatMessageTail?: number;
  transcriptTail?: number;
};

export function isPositiveClaudeTranscriptLimit(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isClaudeChatEntry(entry: AgentTranscriptEntry) {
  return entry.role === "user" || entry.role === "assistant";
}

export function hasRequestedClaudeTranscriptTail(
  transcript: AgentTranscriptEntry[],
  options: ClaudeTranscriptTailOptions
) {
  if (isPositiveClaudeTranscriptLimit(options.chatMessageTail)) {
    return transcript.filter(isClaudeChatEntry).length >= options.chatMessageTail;
  }
  return transcript.length >= (options.transcriptTail ?? 0);
}

export function trimClaudeTranscript(
  transcript: AgentTranscriptEntry[],
  options: ClaudeTranscriptTailOptions
) {
  if (isPositiveClaudeTranscriptLimit(options.chatMessageTail)) {
    const chatIndexes = transcript
      .map((entry, index) => (isClaudeChatEntry(entry) ? index : -1))
      .filter((index) => index >= 0);
    const start = chatIndexes[Math.max(0, chatIndexes.length - options.chatMessageTail)] ?? 0;
    return transcript.slice(start);
  }
  if (isPositiveClaudeTranscriptLimit(options.transcriptTail)) {
    return transcript.slice(-options.transcriptTail);
  }
  return transcript;
}
