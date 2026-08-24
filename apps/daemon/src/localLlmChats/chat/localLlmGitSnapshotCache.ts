import type { GitSnapshot, LocalLlmChatWorkspace } from "@deskcue/protocol";
import { buildGitSnapshot } from "#infrastructure/git";
import { logger } from "#infrastructure/logging/logger";

function emptyLocalLlmGitSnapshot(): GitSnapshot {
  return {
    branch: null,
    changedFiles: [],
    diff: "",
    isDirty: false,
    isGitRepo: false,
    lastUpdatedAt: new Date().toISOString()
  };
}

export class LocalLlmGitSnapshotCache {
  private readonly reads = new Map<string, Promise<GitSnapshot>>();
  private readonly snapshots = new Map<string, GitSnapshot>();

  clear() {
    this.snapshots.clear();
  }

  delete(chatId: string) {
    this.snapshots.delete(chatId);
  }

  async read(chatId: string, workspace: LocalLlmChatWorkspace | null, refresh: boolean) {
    if (!workspace) {
      const cached = this.snapshots.get(chatId);

      if (cached) return cached;

      const empty = emptyLocalLlmGitSnapshot();

      this.snapshots.set(chatId, empty);

      return empty;
    }

    if (!refresh) {
      const cached = this.snapshots.get(chatId);

      if (cached) return cached;
    }

    const activeRead = this.reads.get(chatId);

    if (activeRead) return activeRead;

    const read = buildGitSnapshot(workspace.path).catch((error: unknown) => {
      logger.warn("Failed to read local chat git snapshot", {
        chatId,
        workspaceId: workspace.id,
        error: error instanceof Error ? error.message : "Unknown git snapshot error"
      });
      return emptyLocalLlmGitSnapshot();
    }).then((snapshot) => {
      this.snapshots.set(chatId, snapshot);
      return snapshot;
    }).finally(() => {
      if (this.reads.get(chatId) === read) this.reads.delete(chatId);
    });

    this.reads.set(chatId, read);
    return read;
  }
}
