import type { CodexTranscriptRole } from "@deskcue/protocol";

import { buildAssistantMessageParts, buildUserMessageParts } from "./codexTranscriptAttachments.ts";
import { createCodexTranscriptEntry } from "./codexTranscriptEntryFactory.ts";
import {
  extractExternalCodexDelegationInput,
  extractMessageText,
  isTurnAbortedMessage,
  normalizeAssistantMessageText,
  normalizeUserMessageText
} from "./codexTranscriptMessages.ts";

export function toCodexMessageTranscriptEntry(
  itemType: string,
  payload: Record<string, unknown> | null,
  sessionId: string,
  index: number,
  timestamp: string
) {
  if (itemType === "event_msg" && payload?.type === "user_message") {
    const rawText = typeof payload.message === "string" ? payload.message.trim() : "";
    const externalInput = extractExternalCodexDelegationInput(rawText);
    const text = normalizeUserMessageText(externalInput ?? rawText, payload);
    const parts = buildUserMessageParts(payload, text, rawText);
    const entry = text || parts.length > 0
      ? createCodexTranscriptEntry(sessionId, index, timestamp, "user", text, null, parts)
      : null;
    return entry && externalInput ? { ...entry, origin: "external" as const } : entry;
  }

  if (itemType === "response_item" && payload?.type === "message" && payload.role === "user") {
    const rawText = extractMessageText(payload.content);
    const externalInput = extractExternalCodexDelegationInput(rawText);
    const text = normalizeUserMessageText(externalInput ?? rawText, payload);
    const parts = buildUserMessageParts(payload, text, rawText);
    if (isTurnAbortedMessage(text)) {
      return null;
    }

    const entry = text || parts.length > 0
      ? createCodexTranscriptEntry(sessionId, index, timestamp, "user", text, null, parts)
      : null;
    return entry && externalInput ? { ...entry, origin: "external" as const } : entry;
  }

  if (itemType === "response_item" && payload?.type === "message") {
    if (payload.role !== "assistant") {
      return null;
    }

    const text = normalizeAssistantMessageText(extractMessageText(payload.content));
    const phase = typeof payload.phase === "string" ? payload.phase : null;
    const transcriptRole: CodexTranscriptRole =
      phase === "commentary" ? "commentary" : "assistant";
    const parts = buildAssistantMessageParts(text);

    return text
      ? createCodexTranscriptEntry(sessionId, index, timestamp, transcriptRole, text, phase, parts)
      : null;
  }

  return undefined;
}
