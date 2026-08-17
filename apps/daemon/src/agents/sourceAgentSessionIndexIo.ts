import { createHash } from "node:crypto";
import { rename } from "node:fs/promises";

import type { AgentSessionSummary } from "@deskcue/protocol";

const SOURCE_AGENT_INDEX_RENAME_RETRY_DELAYS_MS = [25, 75, 150];

export type DescriptorSessionLists = AgentSessionSummary[][];

export type StoredSourceAgentIndexSnapshot = {
  cacheKey: string;
  cachedAt: string;
  sessions: DescriptorSessionLists;
};

export async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<void>
) {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      await worker(value);
    }
  }));
}

export function estimateSnapshotEnvelopeBytes(snapshotCount: number) {
  return 32 + snapshotCount;
}

export async function renameSourceAgentIndexWithRetry(
  temporary: string,
  destination: string
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const delayMs = SOURCE_AGENT_INDEX_RENAME_RETRY_DELAYS_MS[attempt];
      if ((code !== "EPERM" && code !== "ENOTEMPTY") || delayMs === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function measureSourceAgentSnapshotBytes(snapshot: unknown) {
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8");
}

export function hashSourceAgentCacheKey(cacheKey: string) {
  return createHash("sha1").update(cacheKey).digest("base64url");
}

export function isStoredSourceAgentIndexSnapshot(
  value: unknown
): value is StoredSourceAgentIndexSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<StoredSourceAgentIndexSnapshot>;
  return (
    typeof snapshot.cacheKey === "string" &&
    typeof snapshot.cachedAt === "string" &&
    Array.isArray(snapshot.sessions)
  );
}

export function countSourceAgentSnapshotSessions(sessions: DescriptorSessionLists) {
  return sessions.reduce((count, list) => count + list.length, 0);
}
