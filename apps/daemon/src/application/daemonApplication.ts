import { LocalSourceAgentSessionDiscovery } from "#agents/sourceAgentDiscovery";
import { DeskCueStore } from "#backend/deskCueStore";
import { daemonConfig } from "#config/daemonConfig";
import { CloudConnectorService } from "#infrastructure/cloud/cloudConnectorService";
import { LocalLlmChatService } from "#localLlmChats/chat/localLlmChatService";
import { LocalLlmChatLibrary } from "#localLlmChats/storage/localLlmChatLibrary";
import { LocalLlmToolExecutor } from "#localLlmChats/tools/localLlmToolExecutor";
import { getProductionSqliteDatabaseContext } from "#persistence/connection/sqliteConnection";
import type { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";
import { SqliteAgentSessionReviewStore } from "#persistence/journals/agentSessionReviewStore";
import { startStorageMaintenanceScheduler } from "#persistence/maintenance/storageMaintenance";
import { LmStudioRuntimeCoordinator } from "#runtimeDiagnostics/lmStudioRuntimeCoordinator";
import { ManualCommandRunner } from "#sessions/manual/manualCommandRunner";
import { WorkspaceFileService } from "#workspaces/files/workspaceFileService";

import { DaemonEventBus } from "./daemonEventBus.ts";
import { ManagedSessionService } from "./managedSessionService.ts";
import { ManualCommandService } from "./manualCommands/manualCommandService.ts";
import type { DaemonEventBus as DaemonEventBusPort } from "./ports.ts";
import { SourceAgentSessionService } from "./sourceAgentSessionService.ts";
import { WorkspaceService } from "./workspaceService.ts";

export type DaemonApplication = {
  close: () => Promise<void>;
  cloud: CloudConnectorService;
  events: DaemonEventBusPort;
  managedSessions: ManagedSessionService;
  manualCommands: ManualCommandService;
  localLlmChats: LocalLlmChatService;
  lmStudioRuntime: LmStudioRuntimeCoordinator;
  sourceAgentSessions: SourceAgentSessionService;
  workspaceFiles: WorkspaceFileService;
  workspaces: WorkspaceService;
};

export async function closeDaemonApplicationResources({
  agentSessionReviews,
  cloud,
  discovery,
  localLlmChats,
  lmStudioRuntime,
  manualCommands,
  sourceAgentSessions,
  storageMaintenance,
  store
}: {
  agentSessionReviews: SqliteAgentSessionReviewStore | null;
  cloud?: CloudConnectorService | null;
  discovery: LocalSourceAgentSessionDiscovery;
  localLlmChats: LocalLlmChatService | null;
  lmStudioRuntime?: LmStudioRuntimeCoordinator | null;
  manualCommands: ManualCommandService | null;
  sourceAgentSessions: SourceAgentSessionService | null;
  storageMaintenance: ReturnType<typeof startStorageMaintenanceScheduler> | null;
  store: DeskCueStore | null;
}) {
  const failures: unknown[] = [];

  try {
    await cloud?.close();
  } catch (error) {
    failures.push(error);
  }

  try {
    await storageMaintenance?.close();
  } catch (error) {
    failures.push(error);
  }

  try {
    await sourceAgentSessions?.close();
  } catch (error) {
    failures.push(error);
  }

  const results = await Promise.allSettled([
    discovery.close(),
    localLlmChats?.close(),
    manualCommands?.close(),
    store?.close()
  ]);

  failures.push(...results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((failure) => (failure as { reason: unknown }).reason));

  try {
    await lmStudioRuntime?.close();
  } catch (error) {
    failures.push(error);
  }

  try {
    agentSessionReviews?.close();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length > 0) throw new AggregateError(failures, "One or more daemon services failed to drain.");
}

export async function createDaemonApplication(
  sqliteContext: SqliteDatabaseContext = getProductionSqliteDatabaseContext(
    daemonConfig.databaseFilePath
  )
): Promise<DaemonApplication> {
  const events = new DaemonEventBus();
  const discovery = new LocalSourceAgentSessionDiscovery();
  let store: DeskCueStore | null = null;
  let agentSessionReviews: SqliteAgentSessionReviewStore | null = null;
  let storageMaintenance: ReturnType<typeof startStorageMaintenanceScheduler> | null = null;
  let localLlmChats: LocalLlmChatService | null = null;
  let lmStudioRuntime: LmStudioRuntimeCoordinator | null = null;
  let manualCommands: ManualCommandService | null = null;
  let sourceAgentSessions: SourceAgentSessionService | null = null;
  let cloud: CloudConnectorService | null = null;

  try {
    store = await DeskCueStore.create(events, sqliteContext);
    agentSessionReviews = new SqliteAgentSessionReviewStore(sqliteContext);
    const workspaces = new WorkspaceService(store);
    const workspaceFiles = new WorkspaceFileService(workspaces);

    manualCommands = new ManualCommandService(workspaces, new ManualCommandRunner());

    lmStudioRuntime = new LmStudioRuntimeCoordinator();
    localLlmChats = new LocalLlmChatService(
      new LocalLlmChatLibrary(daemonConfig.localChatLibraryPath, {
        quotaBytes: daemonConfig.localChatLibraryQuotaBytes
      }),
      undefined,
      workspaces,
      undefined,
      undefined,
      new LocalLlmToolExecutor({ deniedExecutables: daemonConfig.localLlmDeniedExecutables }),
      events,
      (model) => lmStudioRuntime!.getModelReadiness(model),
      {
        maxConcurrentGenerations: daemonConfig.localLlmMaxConcurrentGenerations,
        queueCapacity: daemonConfig.localLlmGenerationQueueCapacity
      }
    );
    sourceAgentSessions = new SourceAgentSessionService(
      store,
      discovery,
      workspaces,
      agentSessionReviews,
      events
    );
    const managedSessions = new ManagedSessionService(store, sourceAgentSessions);

    cloud = new CloudConnectorService(sqliteContext, events, {
      listLocalLlmChats: () => localLlmChats!.listChats(),
      listManagedSessions: () => managedSessions.listSessions(),
      listSourceSessions: () => sourceAgentSessions!.listRecentSessions(200, false)
    });
    storageMaintenance = startStorageMaintenanceScheduler({}, {
      isQuiescent: () =>
        !localLlmChats?.hasActiveGenerations() &&
        !store?.listSessions().some((session) => session.status === "running")
    });

    return {
      close: () => closeDaemonApplicationResources({
        agentSessionReviews,
        cloud,
        discovery,
        localLlmChats,
        lmStudioRuntime,
        manualCommands,
        sourceAgentSessions,
        storageMaintenance,
        store
      }),
      cloud,
      events,
      managedSessions,
      manualCommands,
      localLlmChats,
      lmStudioRuntime,
      sourceAgentSessions,
      workspaceFiles,
      workspaces
    };
  } catch (startupError) {
    try {
      await closeDaemonApplicationResources({
        agentSessionReviews,
        cloud,
        discovery,
        localLlmChats,
        lmStudioRuntime,
        manualCommands,
        sourceAgentSessions,
        storageMaintenance,
        store
      });
    } catch (rollbackError) {
      throw new AggregateError(
        [startupError, rollbackError],
        "Daemon application startup failed and its rollback was incomplete."
      );
    }

    throw startupError;
  }
}
