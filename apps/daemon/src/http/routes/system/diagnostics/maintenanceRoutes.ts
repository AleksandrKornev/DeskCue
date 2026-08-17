import type express from "express";

import { AppError } from "#application/errors";
import type { ManagedSessionService } from "#application/managedSessionService";
import type { LocalLlmChatService } from "#localLlmChats/chat/localLlmChatService";
import {
  clearMigrationBackups,
  readStorageMaintenanceStats
} from "#persistence/maintenance/storageMaintenance";
import { runFullStorageMaintenanceInWorker } from "#persistence/maintenance/storageMaintenanceWorkerClient";

type MaintenanceRoutesOptions = {
  localLlmChats: Pick<LocalLlmChatService, "hasActiveGenerations">;
  managedSessions: ManagedSessionService;
};

function assertNoRunningManagedSessions(managedSessions: ManagedSessionService) {
  const runningSessions = managedSessions
    .listSessions()
    .filter((session) => session.status === "running");

  if (runningSessions.length > 0) {
    throw new AppError(
      "conflict",
      "Storage maintenance is only available when no managed sessions are running."
    );
  }
}

function assertMaintenanceIsQuiescent(
  managedSessions: ManagedSessionService,
  localLlmChats: Pick<LocalLlmChatService, "hasActiveGenerations">
) {
  assertNoRunningManagedSessions(managedSessions);
  if (localLlmChats.hasActiveGenerations()) {
    throw new AppError(
      "conflict",
      "Storage maintenance is only available when no Local LLM generation is running."
    );
  }
}

export function installMaintenanceRoutes(
  app: express.Express,
  { localLlmChats, managedSessions }: MaintenanceRoutesOptions
) {
  app.get("/api/maintenance/storage", (_request, response) => {
    response.json(readStorageMaintenanceStats());
  });

  app.post("/api/maintenance/storage/compact", async (_request, response, next) => {
    try {
      assertMaintenanceIsQuiescent(managedSessions, localLlmChats);
      response.json(await runFullStorageMaintenanceInWorker({
        clearLogs: true,
        purgeTerminalSessions: true
      }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/maintenance/storage/migration-backups/clear", (_request, response) => {
    assertNoRunningManagedSessions(managedSessions);
    response.json(clearMigrationBackups());
  });
}
