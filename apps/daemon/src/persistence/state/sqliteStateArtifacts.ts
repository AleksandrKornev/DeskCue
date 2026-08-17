import {
  existsSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { basename, join } from "node:path";

import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

const OLD_STATE_ARTIFACT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const ORPHAN_TEMP_ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const OLD_STATE_ARTIFACT_MAX_FILES_PER_KIND = 2;

function readStateArtifactKind(fileName: string) {
  const name = basename(fileName);
  const sourceAgentIndexName = basename(daemonConfig.agentSessionIndexFilePath);
  if (
    name.startsWith(`${sourceAgentIndexName}.`) &&
    /^\d+\.[^.]+\.tmp$/.test(name.slice(sourceAgentIndexName.length + 1))
  ) {
    return "source-agent-index-tmp";
  }
  if (/^state\.[^.]+\.tmp$/.test(name)) return "state-tmp";
  if (/^codex-transcript-line-counts\.[^.]+\.tmp$/.test(name)) {
    return "codex-transcript-index-tmp";
  }
  if (/^agent-session-turn-states\.[^.]+\.tmp$/.test(name)) {
    return "agent-session-turn-state-tmp";
  }
  if (/^state\.corrupt-.*\.json$/.test(name)) return "state-corrupt";
  if (/^deskcue\.sqlite\.backup-v/.test(name)) return "sqlite-backup";
  return null;
}

export function pruneOldStateArtifacts(dataDir: string) {
  if (!existsSync(dataDir)) {
    return;
  }
  const now = Date.now();
  const candidates = readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = join(dataDir, entry.name);
      const stats = statSync(filePath);
      return {
        filePath,
        kind: readStateArtifactKind(entry.name),
        mtimeMs: stats.mtimeMs,
        sizeBytes: stats.size
      };
    })
    .filter((entry) => entry.kind !== null);

  const byKind = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const kind = candidate.kind ?? "unknown";
    byKind.set(kind, [...(byKind.get(kind) ?? []), candidate]);
  }

  let prunedFiles = 0;
  let prunedBytes = 0;
  for (const entries of byKind.values()) {
    const sorted = entries.sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (const [index, entry] of sorted.entries()) {
      const maxAgeMs = entry.kind?.endsWith("-tmp")
        ? ORPHAN_TEMP_ARTIFACT_MAX_AGE_MS
        : OLD_STATE_ARTIFACT_MAX_AGE_MS;
      if (
        now - entry.mtimeMs <= maxAgeMs &&
        index < OLD_STATE_ARTIFACT_MAX_FILES_PER_KIND
      ) {
        continue;
      }
      rmSync(entry.filePath, { force: true });
      prunedFiles += 1;
      prunedBytes += entry.sizeBytes;
    }
  }

  if (prunedFiles > 0) {
    logger.info("Pruned old daemon state artifacts", {
      dataDir,
      prunedBytes,
      prunedFiles
    });
  }
}
