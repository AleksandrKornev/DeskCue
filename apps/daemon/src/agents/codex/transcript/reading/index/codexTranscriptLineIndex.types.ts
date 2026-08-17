import type { Stats } from "node:fs";

export type IndexedTranscriptActivityKind = "changes" | "details" | "tools";

export interface TranscriptLineOffset {
  byteOffset: number;
  lineIndex: number;
}

export interface TranscriptCompactLineSpan {
  end: number;
  kind: IndexedTranscriptActivityKind;
  start: number;
  timestamp: string;
}

export interface TranscriptLineIndexSnapshot {
  chatMessageLineOffsets?: TranscriptLineOffset[];
  compactLineSpans?: TranscriptCompactLineSpan[];
  contextCompactionCount?: number;
  endsWithLineBreak?: boolean;
  exactLineOffsets?: TranscriptLineOffset[];
  lineHintsComplete?: boolean;
  lineBreakCount: number;
  lineOffsets?: TranscriptLineOffset[];
  mtimeMs: number;
  size: number;
}

export interface TranscriptLineIndexReadOptions {
  requireChatMessageOffsets?: boolean;
  requireLineHints?: boolean;
  requireOffsets?: boolean;
}

export interface TranscriptLineIndexScanner {
  readAppendSnapshot(
    cached: TranscriptLineIndexSnapshot,
    filePath: string,
    options: {
      appendStartByteOffset: number;
      mtimeMs: number;
      requireChatMessageOffsets: boolean;
      requireLineHints: boolean;
      requireOffsets: boolean;
      size: number;
    }
  ): Promise<TranscriptLineIndexSnapshot>;
  readFullSnapshot(
    filePath: string,
    fileStat: Stats,
    options: {
      includeChatMessageOffsets: boolean;
      includeLineHints: boolean;
      includeOffsets: boolean;
    }
  ): Promise<TranscriptLineIndexSnapshot>;
}
