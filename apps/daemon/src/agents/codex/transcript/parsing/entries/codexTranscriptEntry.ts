import { toCodexLifecycleTranscriptEntry } from "./codexTranscriptLifecycleEntries.ts";
import { toCodexMessageTranscriptEntry } from "./codexTranscriptMessageEntries.ts";
import { isRecord } from "../codexTranscriptShared.ts";
import { toCodexToolTranscriptEntry } from "./codexTranscriptToolEntries.ts";

export function toCodexTranscriptEntry(
  item: Record<string, unknown> | null,
  sessionId: string,
  index: number
) {
  if (!item || typeof item.type !== "string") {
    return null;
  }

  const timestamp = typeof item.timestamp === "string" ? item.timestamp : new Date(0).toISOString();
  const payload = isRecord(item.payload) ? item.payload : null;
  const messageEntry = toCodexMessageTranscriptEntry(
    item.type,
    payload,
    sessionId,
    index,
    timestamp
  );

  if (messageEntry !== undefined) {
    return messageEntry;
  }

  const toolEntry = toCodexToolTranscriptEntry(
    item.type,
    payload,
    sessionId,
    index,
    timestamp
  );

  if (toolEntry !== undefined) {
    return toolEntry;
  }

  const lifecycleEntry = toCodexLifecycleTranscriptEntry(
    item.type,
    payload,
    sessionId,
    index,
    timestamp
  );

  return lifecycleEntry ?? null;
}
