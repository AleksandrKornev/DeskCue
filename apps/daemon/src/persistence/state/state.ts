import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

import { emptyPersistedDeskCueState } from "./types.ts";
import type { DaemonStateStorage, PersistedDeskCueState } from "./types.ts";

const stateFilePath = daemonConfig.stateFilePath;

function isFileNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
  );
}

function isJsonParseError(error: unknown) {
  return error instanceof SyntaxError;
}

export class DeskCueJsonStateStorage implements DaemonStateStorage {
  private activeWrite: Promise<void> | null = null;
  private pendingSnapshot: PersistedDeskCueState | null = null;

  async load(): Promise<PersistedDeskCueState> {
    try {
      const raw = await readFile(stateFilePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PersistedDeskCueState>;

      return {
        version: 1,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
      };
    } catch (error) {
      if (isFileNotFound(error)) {
        logger.info("No persisted daemon state found, starting fresh", {
          stateFile: stateFilePath
        });
        return structuredClone(emptyPersistedDeskCueState);
      }

      const message = error instanceof Error ? error.message : "Failed to read daemon state.";
      if (isJsonParseError(error)) {
        await this.backupCorruptedStateFile();
      }
      logger.error("Failed to load daemon state", {
        stateFile: stateFilePath,
        message
      });
      return structuredClone(emptyPersistedDeskCueState);
    }
  }

  async save(state: PersistedDeskCueState) {
    this.pendingSnapshot = state;

    if (!this.activeWrite) {
      this.activeWrite = this.flushPendingSnapshots().finally(() => {
        this.activeWrite = null;
      });
    }

    await this.activeWrite;
  }

  private async flushPendingSnapshots() {
    while (this.pendingSnapshot) {
      const snapshot = this.pendingSnapshot;
      this.pendingSnapshot = null;

      try {
        await mkdir(dirname(stateFilePath), { recursive: true });
        const tempFilePath = join(dirname(stateFilePath), `state.${randomUUID()}.tmp`);
        await writeFile(tempFilePath, JSON.stringify(snapshot, null, 2), "utf-8");
        await rename(tempFilePath, stateFilePath);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to persist daemon state.";
        logger.error("Failed to persist daemon state", {
          stateFile: stateFilePath,
          message
        });
      }
    }
  }

  private async backupCorruptedStateFile() {
    try {
      const corruptedStatePath = join(
        dirname(stateFilePath),
        `state.corrupt-${Date.now()}-${randomUUID()}.json`
      );
      await rename(stateFilePath, corruptedStatePath);
      logger.warn("Corrupted daemon state moved aside", {
        stateFile: stateFilePath,
        corruptedStateFile: corruptedStatePath
      });
    } catch (error) {
      if (isFileNotFound(error)) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Failed to move corrupted daemon state.";
      logger.error("Failed to move corrupted daemon state", {
        stateFile: stateFilePath,
        message
      });
    }
  }
}
