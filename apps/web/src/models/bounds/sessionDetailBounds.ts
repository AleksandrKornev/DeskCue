import type { SessionDetail, SessionLogLine } from "@deskcue/protocol";

const MAX_LIVE_SESSION_LOGS = 2_000;
const MAX_LIVE_SESSION_LOG_BYTES = 4 * 1024 * 1024;
const MAX_CACHED_SESSION_LOGS = 160;
const MAX_CACHED_SESSION_LOG_BYTES = 256 * 1024;
const MAX_CACHED_INPUT_HISTORY = 32;
const MAX_CACHED_INPUT_HISTORY_BYTES = 128 * 1024;

function estimateWireBytes(value: unknown) {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function retainNewestWithinBudget<T>(records: T[], maxCount: number, maxBytes: number) {
  if (records.length <= maxCount && estimateWireBytes(records) <= maxBytes) {
    return records;
  }

  const retained: T[] = [];
  let retainedBytes = 2;
  for (let index = records.length - 1; index >= 0 && retained.length < maxCount; index -= 1) {
    const record = records[index];
    const recordBytes = estimateWireBytes(record) + 2;
    if (recordBytes > maxBytes || retainedBytes + recordBytes > maxBytes) {
      continue;
    }
    retained.push(record);
    retainedBytes += recordBytes;
  }
  return retained.reverse();
}

export function boundLiveSessionDetail(detail: SessionDetail): SessionDetail {
  const logs = retainNewestWithinBudget(
    detail.logs,
    MAX_LIVE_SESSION_LOGS,
    MAX_LIVE_SESSION_LOG_BYTES
  );
  return logs === detail.logs ? detail : { ...detail, logs };
}

export function trimSessionDetailForCache(detail: SessionDetail): SessionDetail {
  return {
    ...detail,
    inputHistory: retainNewestWithinBudget(
      detail.inputHistory,
      MAX_CACHED_INPUT_HISTORY,
      MAX_CACHED_INPUT_HISTORY_BYTES
    ),
    logs: retainNewestWithinBudget(
      detail.logs,
      MAX_CACHED_SESSION_LOGS,
      MAX_CACHED_SESSION_LOG_BYTES
    )
  };
}

export function boundLiveSessionLogs(logs: SessionLogLine[]) {
  return retainNewestWithinBudget(logs, MAX_LIVE_SESSION_LOGS, MAX_LIVE_SESSION_LOG_BYTES);
}
