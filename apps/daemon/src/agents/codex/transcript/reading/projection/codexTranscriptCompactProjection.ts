import type { AgentTranscriptEntry } from "@deskcue/protocol";

import {
  CODEX_CHAT_MESSAGE_LINE_DETECTION_MAX_BYTES,
  CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES
} from "../codexTranscriptReadLimits.ts";
import { createCompactIndexedTranscriptEntry } from "./codexTranscriptCompactIndexProjection.ts";
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
  prefixChunks: Buffer[];
  prefixBytes: number;
  retention: CompactTranscriptLineRetention;
  typeHint: CodexTranscriptLineTypeHint | null;
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
    prefixChunks: [],
    prefixBytes: 0,
    retention: "undecided",
    typeHint: null
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
  const typeHint = readCodexTranscriptLineTypeHint(readCompactTranscriptLinePrefix(line));
  const decision = resolveKnownCompactTranscriptLineDecision(typeHint);
  if (!decision) {
    return;
  }

  line.typeHint = typeHint;
  line.retention = decision.retention;
  line.compactKind = decision.compactKind;

  if (line.retention === "compact") {
    line.fullChunks = [];
    line.fullBytes = 0;
  }
}

export function appendCompactTranscriptLineBytes(
  line: CompactTranscriptLineAccumulator,
  chunk: Buffer
) {
  if (chunk.length === 0) {
    return;
  }

  if (line.retention !== "compact") {
    line.fullChunks.push(chunk);
    line.fullBytes += chunk.length;
  }

  if (line.prefixBytes < CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES) {
    const retainedLength = Math.min(
      chunk.length,
      CODEX_TRANSCRIPT_INDEXED_LINE_HINT_BYTES - line.prefixBytes
    );
    line.prefixChunks.push(chunk.subarray(0, retainedLength));
    line.prefixBytes += retainedLength;
  }

  if (line.retention === "undecided") {
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
    line.fullChunks = [];
    line.fullBytes = 0;
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
  const typeHint = line.typeHint ?? readCodexTranscriptLineTypeHint(
    readCompactTranscriptLinePrefix(line)
  );

  if (line.retention === "compact") {
    return {
      compactEntry: line.compactKind
        ? createCompactIndexedTranscriptEntry({
            kind: line.compactKind,
            lineIndex,
            sessionId,
            timestamp: typeHint.timestamp
          })
        : null,
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

  const fullTypeHint = readCodexTranscriptLineTypeHint(trimmedLine);
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
