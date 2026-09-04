import type { AgentTranscriptEntry } from "@deskcue/protocol";

import {
  CODEX_CHAT_MESSAGE_LINE_DETECTION_MAX_BYTES,
  CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES,
  CODEX_TRANSCRIPT_LINE_RETENTION_MAX_BYTES
} from "../codexTranscriptReadLimits.ts";
import { createCompactIndexedTranscriptEntry } from "./codexTranscriptCompactIndexProjection.ts";
import {
  appendCodexTranscriptJsonObjectBytes,
  createCodexTranscriptJsonObjectScan,
  isCompleteCodexTranscriptJsonObject,
  isValidCodexTranscriptJsonObjectText
} from "./codexTranscriptJsonObjectScan.ts";
import type { CodexTranscriptJsonObjectScan } from "./codexTranscriptJsonObjectScan.ts";
import {
  classifyIndexedTranscriptActivityLine,
  readCodexTranscriptLineTypeHint,
  shouldKeepIndexedTranscriptLineExact
} from "./codexTranscriptLineClassifier.ts";
import type { CodexTranscriptLineTypeHint } from "./codexTranscriptLineClassifier.ts";
import type { IndexedTranscriptActivityKind } from "../index/codexTranscriptLineIndex.ts";
export type { CodexTranscriptLineTypeHint } from "./codexTranscriptLineClassifier.ts";

type CompactTranscriptLineRetention = "undecided" | "keep" | "compact";

type CompactTranscriptLineAccumulator = {
  compactKind: IndexedTranscriptActivityKind | null;
  fullChunks: Buffer[];
  fullBytes: number;
  fullTruncated: boolean;
  jsonObjectScan: CodexTranscriptJsonObjectScan;
  lastResolvedPrefixBytes: number;
  prefixChunks: Buffer[];
  prefixBytes: number;
  retention: CompactTranscriptLineRetention;
};

type CompactTranscriptLineResult = {
  compactEntry: AgentTranscriptEntry | null;
  containsTurnContextLine: boolean;
  selectedLine: { index: number; line: string } | null;
};

export function createCompactTranscriptLineAccumulator(): CompactTranscriptLineAccumulator {
  return {
    compactKind: null,
    fullChunks: [],
    fullBytes: 0,
    fullTruncated: false,
    jsonObjectScan: createCodexTranscriptJsonObjectScan(),
    lastResolvedPrefixBytes: -1,
    prefixChunks: [],
    prefixBytes: 0,
    retention: "undecided"
  };
}

export function resolveKnownCompactTranscriptLineDecision(
  typeHint: CodexTranscriptLineTypeHint
): { compactKind: IndexedTranscriptActivityKind | null; retention: CompactTranscriptLineRetention } | null {
  if (
    typeHint.itemType === "turn_context" ||
    typeHint.itemType === "compacted" ||
    typeHint.payloadType === "compacted" ||
    typeHint.payloadType === "task_started" ||
    typeHint.payloadType === "task_complete" ||
    typeHint.payloadType === "turn_aborted"
  ) {
    return {
      compactKind: null,
      retention: "keep"
    };
  }

  if (typeHint.itemType === "event_msg") {
    if (!typeHint.payloadType) {
      return null;
    }

    if (typeHint.payloadType === "user_message") {
      return {
        compactKind: null,
        retention: "keep"
      };
    }

    if (typeHint.payloadType === "item_completed" && !typeHint.payloadItemType) return null;

    return {
      compactKind: classifyIndexedTranscriptActivityLine(typeHint),
      retention: "compact"
    };
  }

  if (typeHint.itemType === "response_item") {
    if (!typeHint.payloadType) {
      return null;
    }

    if (typeHint.payloadType === "message") {
      if (!typeHint.payloadRole) {
        return null;
      }

      if (
        (typeHint.payloadRole === "user" || typeHint.payloadRole === "assistant") &&
        typeHint.payloadPhase !== "commentary"
      ) {
        return {
          compactKind: null,
          retention: "keep"
        };
      }

      if (
        typeHint.payloadRole === "assistant" &&
        typeHint.payloadPhase === "commentary"
      ) {
        return {
          compactKind: "details",
          retention: "keep"
        };
      }
    }

    return {
      compactKind: classifyIndexedTranscriptActivityLine(typeHint),
      retention: "compact"
    };
  }

  return null;
}

export function hasPendingCompactTranscriptLine(line: CompactTranscriptLineAccumulator) {
  return line.fullBytes > 0 || line.prefixBytes > 0 || line.retention !== "undecided";
}

function readCompactTranscriptLinePrefix(line: CompactTranscriptLineAccumulator) {
  if (line.prefixBytes === 0) {
    return "";
  }

  return Buffer.concat(line.prefixChunks, line.prefixBytes).toString("utf8").trim();
}

function resolveCompactTranscriptLinePrefix(line: CompactTranscriptLineAccumulator) {
  line.lastResolvedPrefixBytes = line.prefixBytes;

  const typeHint = readCodexTranscriptLineTypeHint(readCompactTranscriptLinePrefix(line));
  const decision = resolveKnownCompactTranscriptLineDecision(typeHint);

  if (!decision) {
    return;
  }

  line.retention = decision.retention;
  line.compactKind = decision.compactKind;
}

export function appendCompactTranscriptLineBytes(
  line: CompactTranscriptLineAccumulator,
  chunk: Buffer
) {
  if (chunk.length === 0) {
    return;
  }

  appendCodexTranscriptJsonObjectBytes(line.jsonObjectScan, chunk);

  if (!line.fullTruncated) {
    const remainingBytes = CODEX_TRANSCRIPT_LINE_RETENTION_MAX_BYTES - line.fullBytes;
    const retainedChunk = chunk.length > remainingBytes
      ? chunk.subarray(0, remainingBytes)
      : chunk;

    if (retainedChunk.length > 0) {
      line.fullChunks.push(retainedChunk);
      line.fullBytes += retainedChunk.length;
    }

    if (retainedChunk.length < chunk.length) line.fullTruncated = true;
  }

  if (line.prefixBytes < CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES) {
    const retainedLength = Math.min(
      chunk.length,
      CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES - line.prefixBytes
    );

    line.prefixChunks.push(chunk.subarray(0, retainedLength));
    line.prefixBytes += retainedLength;
  }

  if (
    line.retention === "undecided" &&
    line.prefixBytes !== line.lastResolvedPrefixBytes
  ) {
    resolveCompactTranscriptLinePrefix(line);
  }

  // Commentary is the only activity that is also user-visible while a turn is
  // running: it feeds both the Details count and the waiting card. Keep a
  // bounded commentary record exact so those two views agree. Very large
  // commentary records still fall back to the compact placeholder path.
  if (
    line.retention === "keep" &&
    line.compactKind === "details" &&
    line.fullBytes > CODEX_CHAT_MESSAGE_LINE_DETECTION_MAX_BYTES
  ) {
    line.retention = "compact";
  }
}

function readCompactTranscriptLineFullText(line: CompactTranscriptLineAccumulator) {
  if (line.fullBytes === 0) {
    return "";
  }

  return Buffer.concat(line.fullChunks, line.fullBytes).toString("utf8");
}

export function finishCompactTranscriptLine(
  line: CompactTranscriptLineAccumulator,
  sessionId: string,
  lineIndex: number
): CompactTranscriptLineResult {
  if (!isCompleteCodexTranscriptJsonObject(line.jsonObjectScan)) {
    return {
      compactEntry: null,
      containsTurnContextLine: false,
      selectedLine: null
    };
  }

  if (line.fullTruncated) {
    return {
      compactEntry: null,
      containsTurnContextLine: false,
      selectedLine: null
    };
  }

  const trimmedLine = readCompactTranscriptLineFullText(line).trim();

  if (!trimmedLine) {
    return {
      compactEntry: null,
      containsTurnContextLine: false,
      selectedLine: null
    };
  }

  if (!isValidCodexTranscriptJsonObjectText(trimmedLine)) {
    return {
      compactEntry: null,
      containsTurnContextLine: false,
      selectedLine: null
    };
  }

  const fullTypeHint = readCodexTranscriptLineTypeHint(trimmedLine);

  if (line.retention === "compact" && line.compactKind) {
    return {
      compactEntry: createCompactIndexedTranscriptEntry({
        kind: line.compactKind,
        lineIndex,
        sessionId,
        timestamp: fullTypeHint.timestamp
      }),
      containsTurnContextLine: false,
      selectedLine: null
    };
  }

  if (shouldKeepIndexedTranscriptLineExact(trimmedLine, fullTypeHint)) {
    return {
      compactEntry: null,
      containsTurnContextLine: fullTypeHint.itemType === "turn_context",
      selectedLine: {
        index: lineIndex,
        line: trimmedLine
      }
    };
  }

  const activityKind = classifyIndexedTranscriptActivityLine(fullTypeHint);

  return {
    compactEntry: activityKind
      ? createCompactIndexedTranscriptEntry({
          kind: activityKind,
          lineIndex,
          sessionId,
          timestamp: fullTypeHint.timestamp
        })
      : null,
    containsTurnContextLine: false,
    selectedLine: null
  };
}

export {
  classifyIndexedTranscriptActivityLine,
  hasJsonStringProperty,
  readCodexTranscriptLineTypeHint,
  shouldKeepIndexedTranscriptLineExact
} from "./codexTranscriptLineClassifier.ts";
export {
  createCompactIndexedTranscriptEntry,
  createCompactIndexedTranscriptEntryRange,
  upsertCompactIndexedTranscriptEntry
} from "./codexTranscriptCompactIndexProjection.ts";
