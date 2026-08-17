import type { AgentTranscriptEntry } from "@deskcue/protocol";

import { parseClaudeTranscriptLines } from "./claudeTranscript.ts";
import {
  hasRequestedClaudeTranscriptTail,
  trimClaudeTranscript
} from "./claudeTranscriptProjection.ts";
import {
  readClaudeTranscriptLinesAtOffsets,
  readClaudeTranscriptPreviousLines,
  readClaudeTranscriptTailLines,
  readClaudeTranscriptWindowLines
} from "./claudeTranscriptReader.ts";
import { getClaudeTranscriptFilePath } from "../discovery/claudeDiscovery.ts";

export async function getClaudeTranscriptTailWindow(
  sessionId: string,
  options: { chatMessageTail?: number; force?: boolean } = {}
) {
  const filePath = await getClaudeTranscriptFilePath(sessionId, options.force ?? false);
  if (!filePath) return null;
  const projectionOptions = { chatMessageTail: options.chatMessageTail };
  const lines = await readClaudeTranscriptTailLines(filePath, (candidateLines) =>
    hasRequestedClaudeTranscriptTail(parseClaudeTranscriptLines(candidateLines, sessionId), projectionOptions)
  );
  return trimClaudeTranscript(parseClaudeTranscriptLines(lines, sessionId), projectionOptions);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readClaudeTranscriptByteOffset(sessionId: string, entryId: string) {
  const match = new RegExp(
    `^${escapeRegExp(sessionId)}-b(\\d+)(?:-(?:text|tool|turn-completed))?$`
  ).exec(entryId);
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) ? offset : null;
}

export async function getClaudeTranscriptEntries(
  sessionId: string,
  entryIds: string[],
  force = false
): Promise<AgentTranscriptEntry[]> {
  const filePath = await getClaudeTranscriptFilePath(sessionId, force);
  if (!filePath) return [];
  const offsets = new Set(entryIds.flatMap((entryId) => {
    const offset = readClaudeTranscriptByteOffset(sessionId, entryId);
    return offset === null ? [] : [offset];
  }));
  const requestedEntryIds = new Set(entryIds);
  return parseClaudeTranscriptLines(
    await readClaudeTranscriptLinesAtOffsets(filePath, offsets),
    sessionId
  ).filter((entry) => requestedEntryIds.has(entry.id));
}

export async function getClaudeTranscriptWindow(
  sessionId: string,
  baseSourceEntryId: string,
  options: { force?: boolean; maxLineCount?: number; overlapLineCount?: number } = {}
) {
  const filePath = await getClaudeTranscriptFilePath(sessionId, options.force ?? false);
  const offset = readClaudeTranscriptByteOffset(sessionId, baseSourceEntryId);
  if (!filePath || offset === null) return null;
  const lines = await readClaudeTranscriptWindowLines(filePath, offset, options);
  return lines ? parseClaudeTranscriptLines(lines, sessionId) : null;
}

export async function getClaudeTranscriptPreviousWindow(
  sessionId: string,
  beforeEntryId: string,
  options: { force?: boolean } = {}
) {
  const filePath = await getClaudeTranscriptFilePath(sessionId, options.force ?? false);
  const offset = readClaudeTranscriptByteOffset(sessionId, beforeEntryId);
  if (!filePath || offset === null) return null;
  const result = await readClaudeTranscriptPreviousLines(filePath, offset);
  return result
    ? { entries: parseClaudeTranscriptLines(result.lines, sessionId), hasMore: result.hasMore }
    : null;
}
