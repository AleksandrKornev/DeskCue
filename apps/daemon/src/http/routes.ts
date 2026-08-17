import type express from "express";

import type { DaemonApplication } from "#application/daemonApplication";
import { daemonConfig } from "#config/daemonConfig";
import type { PushNotificationService } from "#infrastructure/notifications/pushNotificationService";

import { installAccessRoutes } from "./routes/access/accessRoutes.ts";
import { installSecurityRoutes } from "./routes/access/securityRoutes.ts";
import { installAgentSessionRoutes } from "./routes/agents/agentSessionRoutes.ts";
import { installCodexSessionRoutes } from "./routes/agents/codexSessionRoutes.ts";
import { installLocalLlmChatRoutes } from "./routes/agents/localLlmChatRoutes.ts";
import { installSessionRoutes } from "./routes/agents/sessionRoutes.ts";
import { installAssetRoutes } from "./routes/system/assets/assetRoutes.ts";
import { installCloudRoutes } from "./routes/system/cloud/cloudRoutes.ts";
import { installDaemonLogRoutes } from "./routes/system/diagnostics/daemonLogRoutes.ts";
import { installHealthRoutes } from "./routes/system/diagnostics/healthRoutes.ts";
import { installMaintenanceRoutes } from "./routes/system/diagnostics/maintenanceRoutes.ts";
import { installOverviewRoutes } from "./routes/system/diagnostics/overviewRoutes.ts";
import { installRuntimeRoutes } from "./routes/system/diagnostics/runtimeRoutes.ts";
import { installPushNotificationRoutes } from "./routes/system/notifications/pushNotificationRoutes.ts";
import { installWorkspaceFileRoutes } from "./routes/system/workspaceFileRoutes.ts";
import { installWorkspaceRoutes } from "./routes/system/workspaceRoutes.ts";
import type { DecorateSession } from "./types.ts";

type InstallHttpRoutesOptions = {
  application: DaemonApplication;
  decorateSession: DecorateSession;
  pushNotifications: PushNotificationService;
};

export function installHttpRoutes(
  app: express.Express,
  { application, decorateSession, pushNotifications }: InstallHttpRoutesOptions
) {
  installHealthRoutes(app);
  installCloudRoutes(app, application.cloud);
  installAccessRoutes(app);
  installDaemonLogRoutes(app, application.sourceAgentSessions);
  installMaintenanceRoutes(app, {
    localLlmChats: application.localLlmChats,
    managedSessions: application.managedSessions
  });
  installOverviewRoutes(app, {
    application,
    decorateSession,
  });
  installWorkspaceRoutes(app, {
    workspaces: application.workspaces
  });
  installWorkspaceFileRoutes(app, {
    workspaceFiles: application.workspaceFiles
  });
  installAgentSessionRoutes(app, {
    sourceAgentSessions: application.sourceAgentSessions,
    decorateSession,
    httpCompression: daemonConfig.httpCompression,
  });
  installRuntimeRoutes(app, {
    lmStudioRuntime: application.lmStudioRuntime
  });
  installLocalLlmChatRoutes(app, {
    localLlmChats: application.localLlmChats
  });
  installSecurityRoutes(app);
  installPushNotificationRoutes(app, {
    pushNotifications
  });
  installCodexSessionRoutes(app, {
    sourceAgentSessions: application.sourceAgentSessions,
    decorateSession,
  });
  installAssetRoutes(app, {
    managedSessions: application.managedSessions,
    sourceAgentSessions: application.sourceAgentSessions,
    workspaces: application.workspaces
  });
  installSessionRoutes(app, {
    decorateSession,
    manualCommands: application.manualCommands,
    managedSessions: application.managedSessions
  });
}
