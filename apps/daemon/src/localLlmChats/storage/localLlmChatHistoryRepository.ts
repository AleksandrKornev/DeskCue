import { open, stat } from "node:fs/promises";
import path from "node:path";

import type { LocalLlmChatChangeSet, LocalLlmChatMessage } from "@deskcue/protocol";

import {
  MAX_LOCAL_LLM_HISTORY_PAGE_BYTES,
  MAX_LOCAL_LLM_JSONL_RECORD_BYTES
} from "./localLlmChatStorageLimits.ts";
import { isLocalLlmChangeSet, isLocalLlmChatMessage } from "./localLlmChatStorageSchema.ts";
import { isLocalLlmChatEvent } from "../chat/localLlmChatEvents.ts";
import type { LocalLlmChatEvent } from "../chat/localLlmChatEvents.ts";

const HISTORY_READ_CHUNK_BYTES = 64 * 1024;
const MAX_HISTORY_PAGE_SIZE = 200;
const DEFAULT_MESSAGE_PAGE_SIZE = 80;
const DEFAULT_EVENT_PAGE_SIZE = 120;
const DEFAULT_CHANGE_SET_PAGE_SIZE = 20;
const INITIAL_MESSAGE_PAGE_SIZE = 16;
const INITIAL_EVENT_PAGE_SIZE = 20;
const INITIAL_CHANGE_SET_PAGE_SIZE = 4;
const LIVE_MESSAGE_PAGE_SIZE = 3;
const LIVE_EVENT_PAGE_SIZE = 8;
const LIVE_CHANGE_SET_PAGE_SIZE = 2;
const INITIAL_EVENT_SUMMARY_BYTES = 2 * 1024;
const LIVE_EVENT_SUMMARY_BYTES = 768;

export type LocalLlmChatHistoryCursors = {
  changeSets?: string | null;
  events?: string | null;
  messages?: string | null;
};

export type LocalLlmChatHistoryPageMode = "history" | "initial" | "live";

export type LocalLlmChatHistoryPage = {
  changeSets: LocalLlmChatChangeSet[];
  events: LocalLlmChatEvent[];
  history: {
    changeSets: { hasMore: boolean; nextCursor: string | null };
    events: { hasMore: boolean; nextCursor: string | null };
    messages: { hasMore: boolean; nextCursor: string | null };
  };
  messages: LocalLlmChatMessage[];
};

type JsonlPage<T> = { hasMore: boolean; items: T[]; nextCursor: string | null };

function historyPageSizeFor(mode: LocalLlmChatHistoryPageMode) {
  if (mode === "initial") return { changeSets: INITIAL_CHANGE_SET_PAGE_SIZE, events: INITIAL_EVENT_PAGE_SIZE, messages: INITIAL_MESSAGE_PAGE_SIZE };
  if (mode === "live") return { changeSets: LIVE_CHANGE_SET_PAGE_SIZE, events: LIVE_EVENT_PAGE_SIZE, messages: LIVE_MESSAGE_PAGE_SIZE };
  return { changeSets: DEFAULT_CHANGE_SET_PAGE_SIZE, events: DEFAULT_EVENT_PAGE_SIZE, messages: DEFAULT_MESSAGE_PAGE_SIZE };
}

function compactEventForPage(event: LocalLlmChatEvent, maxSummaryBytes: number): LocalLlmChatEvent {
  if (!event.summary || Buffer.byteLength(event.summary, "utf8") <= maxSummaryBytes) return event;
  const prefix = Buffer.from(event.summary, "utf8").subarray(0, maxSummaryBytes).toString("utf8");
  return { ...event, summary: `${prefix}\n\n[Details truncated in the live update]` };
}

function parseHistoryCursor(value: string | null | undefined, fileSize: number) {
  if (!value || !/^\d+$/.test(value)) return fileSize;
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= fileSize ? offset : fileSize;
}

function parseJsonlValue(line: Buffer): unknown {
  try {
    return JSON.parse(line.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

async function readJsonlPage<T>(
  filePath: string,
  isItem: (value: unknown) => value is T,
  cursor: string | null | undefined,
  requestedLimit: number
): Promise<JsonlPage<T>> {
  const limit = Math.min(Math.max(1, requestedLimit), MAX_HISTORY_PAGE_SIZE);
  let fileSize = 0;
  try {
    fileSize = (await stat(filePath)).size;
  } catch {
    return { hasMore: false, items: [], nextCursor: null };
  }

  const endOffset = parseHistoryCursor(cursor, fileSize);
  if (endOffset <= 0) return { hasMore: false, items: [], nextCursor: null };

  const handle = await open(filePath, "r");
  const collected: Array<{ item: T; start: number }> = [];
  let collectedBytes = 0;
  let nextCursorFromByteLimit: number | null = null;
  let position = endOffset;
  let remainder = Buffer.alloc(0);
  try {
    while (position > 0 && collected.length < limit && nextCursorFromByteLimit === null) {
      const start = Math.max(0, position - HISTORY_READ_CHUNK_BYTES);
      const chunk = Buffer.alloc(position - start);
      await handle.read(chunk, 0, chunk.length, start);
      const combined = Buffer.concat([chunk, remainder]);
      let lineEnd = combined.length;

      for (let index = combined.length - 1; index >= 0 && collected.length < limit; index -= 1) {
        if (combined[index] !== 10) continue;
        const lineStart = index + 1;
        const recordEnd = lineEnd;
        const line = combined.subarray(lineStart, recordEnd);
        lineEnd = index;
        if (line.length === 0) continue;
        const parsed = parseJsonlValue(line);
        if (line.byteLength <= MAX_LOCAL_LLM_JSONL_RECORD_BYTES && isItem(parsed)) {
          if (collected.length > 0 && collectedBytes + line.byteLength > MAX_LOCAL_LLM_HISTORY_PAGE_BYTES) {
            nextCursorFromByteLimit = start + recordEnd;
            break;
          }
          collected.push({ item: parsed, start: start + lineStart });
          collectedBytes += line.byteLength;
        }
      }

      if (collected.length >= limit) break;
      remainder = combined.subarray(0, lineEnd);
      if (remainder.byteLength > MAX_LOCAL_LLM_JSONL_RECORD_BYTES) remainder = Buffer.alloc(0);
      position = start;
    }

    if (position === 0 && collected.length < limit && remainder.length > 0 &&
      remainder.byteLength <= MAX_LOCAL_LLM_JSONL_RECORD_BYTES) {
      const parsed = parseJsonlValue(remainder);
      if (isItem(parsed) && (collected.length === 0 || collectedBytes + remainder.byteLength <= MAX_LOCAL_LLM_HISTORY_PAGE_BYTES)) {
        collected.push({ item: parsed, start: 0 });
      }
    }
  } finally {
    await handle.close();
  }

  const oldest = collected.at(-1);
  const nextCursor = nextCursorFromByteLimit ?? (oldest && oldest.start > 0 ? oldest.start : null);
  return {
    hasMore: nextCursor !== null,
    items: collected.reverse().map(({ item }) => item),
    nextCursor: nextCursor === null ? null : String(nextCursor)
  };
}

export async function readLocalLlmChatHistoryPage(
  chatPath: string,
  cursors: LocalLlmChatHistoryCursors,
  mode: LocalLlmChatHistoryPageMode
): Promise<LocalLlmChatHistoryPage> {
  const pageSize = historyPageSizeFor(mode);
  const [messages, events, changeSets] = await Promise.all([
    readJsonlPage(path.join(chatPath, "messages.jsonl"), isLocalLlmChatMessage, cursors.messages, pageSize.messages),
    readJsonlPage(path.join(chatPath, "events.jsonl"), isLocalLlmChatEvent, cursors.events, pageSize.events),
    readJsonlPage(path.join(chatPath, "change-sets.jsonl"), isLocalLlmChangeSet, cursors.changeSets, pageSize.changeSets)
  ]);
  return {
    messages: messages.items,
    events: mode === "history" ? events.items : events.items.map((event) =>
      compactEventForPage(event, mode === "live" ? LIVE_EVENT_SUMMARY_BYTES : INITIAL_EVENT_SUMMARY_BYTES)
    ),
    changeSets: changeSets.items,
    history: {
      messages: { hasMore: messages.hasMore, nextCursor: messages.nextCursor },
      events: { hasMore: events.hasMore, nextCursor: events.nextCursor },
      changeSets: { hasMore: changeSets.hasMore, nextCursor: changeSets.nextCursor }
    }
  };
}

export async function readLocalLlmInferenceTail(filePath: string, limit: number) {
  return readJsonlPage(filePath, isLocalLlmChatMessage, null, limit);
}
