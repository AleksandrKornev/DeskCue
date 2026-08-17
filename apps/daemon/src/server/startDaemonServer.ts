import cors from "cors";
import express from "express";

import type { SessionDetail, SessionSummary } from "@deskcue/protocol";
import { accessDeviceStore, bindProductionAccessDeviceStore } from "#access/accessDevices";
import { createDaemonApplication } from "#application/daemonApplication";
import { daemonConfig } from "#config/daemonConfig";
import { errorHandler } from "#http/middleware/errorHandler";
import { installJsonBodyParsers } from "#http/middleware/jsonBodyParsers";
import { requestLogger } from "#http/middleware/requestLogger";
import { installHttpRoutes } from "#http/routes";
import { createCorsOptions, requireAccessToken } from "#http/routes/access/accessControl";
import { PreviewProxyController } from "#http/routes/system/preview/previewProxy";
import {
  createPreviewConfiguredPortReader,
  createPreviewTargetResolver
} from "#http/routes/system/preview/previewTargetResolver";
import { installWebAppRoutes } from "#http/routes/system/webAppRoutes";
import { flushLogger, logger } from "#infrastructure/logging/logger";
import { createPushNotificationService } from "#infrastructure/notifications/pushNotificationService";
import { getProductionSqliteDatabaseContext } from "#persistence/connection/sqliteConnection";
import { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";
import { createLiveUpdates } from "#realtime/live/server";
import type { LiveUpdatesController } from "#realtime/live/server";

import {
  createCombinedDisposer,
  createControllerClose,
  createRealtimeThenStartCloudIngress
} from "./daemonServerController.ts";
import { createDaemonServiceLifecycle } from "./daemonServiceLifecycle.ts";
import { listenWithRetry } from "./listen.ts";
import {
  closeDaemonResources,
  createShutdownHandler,
  registerHttpServerErrorHandler,
  registerProcessErrorHandlers,
  registerShutdownHandlers
} from "./shutdown.ts";

export type DaemonServerController = {
  baseUrl: string;
  close: () => Promise<void>;
  port: number;
};

function createRealtimeClose(
  liveUpdates: LiveUpdatesController | null,
  previewProxy: PreviewProxyController,
  previewServer: import("node:http").Server | null
) {
  return (callback: () => void) => {
    const closes: Array<Promise<void>> = [previewProxy.close()];
    if (liveUpdates) {
      closes.push(new Promise<void>((resolve) => liveUpdates.close(resolve)));
    }
    if (previewServer?.listening) {
      closes.push(new Promise<void>((resolve) => {
        previewServer.close(() => resolve());
        previewServer.closeIdleConnections();
      }));
    }
    void Promise.allSettled(closes).then(() => callback());
  };
}

function createPreviewProxyApp(previewProxy: PreviewProxyController) {
  const app = express();
  app.use(requestLogger);
  previewProxy.installProxyRoutes(app);
  app.use(errorHandler);
  return app;
}

function readServerPort(server: import("node:http").Server) {
  const address = server.address();
  return typeof address === "object" && address ? address.port : null;
}

function closeDaemonServer({
  closeApplication,
  closeIngress,
  closeRealtime,
  server
}: {
  closeApplication: () => Promise<void>;
  closeIngress: () => Promise<void>;
  closeRealtime: (callback: () => void) => void;
  server: import("node:http").Server;
}) {
  let timeout: NodeJS.Timeout | null = null;
  const closing = closeDaemonResources({
    closeApplication,
    closeIngress,
    closeRealtime,
    server
  }).then(flushLogger);
  const deadline = new Promise<void>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(
        `DeskCue daemon close exceeded ${daemonConfig.shutdownTimeoutMs}ms.`
      ));
    }, daemonConfig.shutdownTimeoutMs);
    timeout.unref?.();
  });

  return Promise.race([closing, deadline]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export async function startDaemonServer(): Promise<DaemonServerController | null> {
  logger.info("DeskCue daemon startup", {
    parentPid: process.ppid,
    pid: process.pid,
    watchMode: process.execArgv.some((argument) => argument === "--watch" || argument.startsWith("--watch-"))
  });
  const app = express();
  let liveUpdates: LiveUpdatesController | null = null;
  let previewProxy: PreviewProxyController | null = null;
  let previewServer: import("node:http").Server | null = null;

  app.use(cors(createCorsOptions()));
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    next();
  });
  app.use(requestLogger);
  app.use(requireAccessToken);
  const sqliteContext = getProductionSqliteDatabaseContext(daemonConfig.databaseFilePath);
  const serviceLifecycle = await createDaemonServiceLifecycle({
    closeAccessStore: () => accessDeviceStore.close(),
    closeSqliteContext: () => sqliteContext.close(),
    createApplication: async () => {
      bindProductionAccessDeviceStore(sqliteContext);
      return createDaemonApplication(sqliteContext);
    },
    createNotifications: (application) => createPushNotificationService({
      events: application.events,
      stateStore: new SqliteNotificationStateStore(sqliteContext)
    })
  });
  const application = serviceLifecycle.application;
  const pushNotifications = serviceLifecycle.notifications;
  const closeApplication = serviceLifecycle.close;
  const resolvePreviewTarget = createPreviewTargetResolver(application);

  application.cloud.configurePreviewTargetResolver(resolvePreviewTarget);

  previewProxy = new PreviewProxyController({
    previewProxyPort: daemonConfig.previewProxyPort,
    readConfiguredPort: createPreviewConfiguredPortReader(application),
    resolveTarget: resolvePreviewTarget
  });
  // Authenticate before accepting large request bodies. Public pairing routes
  // still pass through the access middleware's explicit allowlist.
  installJsonBodyParsers(app);
  previewProxy.installTicketRoute(app);

  const decorateSession = <T extends SessionSummary | SessionDetail>(session: T): T => {
    const viewerCount = liveUpdates?.getViewerCountForSession(session.id) ?? 0;

    return {
      ...session,
      viewerCount,
      canSendInput: session.canSendInput,
      inputBlockedReason: session.inputBlockedReason ?? null
    };
  };

  let server: import("node:http").Server | null = null;
  let disposeShutdownHandlers: (() => void) | null = null;
  let disposeProcessErrorHandlers: (() => void) | null = null;
  let disposeHttpServerErrorHandler: (() => void) | null = null;

  try {
    installHttpRoutes(app, {
      application,
      decorateSession,
      pushNotifications
    });
    app.get("/ws", (_request, response) => {
      response
        .status(426)
        .json({ error: "WebSocket upgrade required for /ws." });
    });
    installWebAppRoutes(app);
    app.use(errorHandler);

    server = await listenWithRetry(app, daemonConfig.daemonPort);
    if (!server) {
      await closeApplication();
      return null;
    }
    previewServer = await listenWithRetry(
      createPreviewProxyApp(previewProxy),
      daemonConfig.previewProxyPort
    );
    if (!previewServer) {
      throw new Error("DeskCue Preview proxy could not start on its configured port.");
    }
    liveUpdates = createRealtimeThenStartCloudIngress({
      createRealtime: () => createLiveUpdates({
        application,
        decorateSession,
        server: server!
      }),
      server,
      setRealtime: (controller) => {
        liveUpdates = controller;
      },
      startCloudIngress: () => application.cloud.start()
    });
    previewProxy.attach(previewServer);

    const closeRealtime = createRealtimeClose(liveUpdates, previewProxy, previewServer);
    const closeIngress = () => application.cloud.close();

    const shutdown = createShutdownHandler({
      closeApplication,
      closeIngress,
      closeRealtime,
      flushLogs: flushLogger,
      server
    });
    disposeHttpServerErrorHandler = registerHttpServerErrorHandler(server, shutdown);
    disposeShutdownHandlers = registerShutdownHandlers(shutdown);
    disposeProcessErrorHandlers = registerProcessErrorHandlers(shutdown);

    const runningServer = server;
    const runningLiveUpdates = liveUpdates;
    const disposeProcessHandlers = createCombinedDisposer([
      disposeShutdownHandlers,
      disposeProcessErrorHandlers,
      disposeHttpServerErrorHandler
    ]);
    const close = createControllerClose(() => closeDaemonServer({
      closeApplication,
      closeIngress,
      closeRealtime: createRealtimeClose(runningLiveUpdates, previewProxy, previewServer),
      server: runningServer
    }), disposeProcessHandlers);
    const port = readServerPort(server) ?? daemonConfig.daemonPort;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close,
      port
    };
  } catch (startupError) {
    disposeProcessErrorHandlers?.();
    disposeShutdownHandlers?.();
    disposeHttpServerErrorHandler?.();

    try {
      if (server) {
        await closeDaemonServer({
          closeApplication,
          closeIngress: () => application.cloud.close(),
          closeRealtime: previewProxy
            ? createRealtimeClose(liveUpdates, previewProxy, previewServer)
            : (callback) => {
                callback();
              },
          server
        });
      } else {
        await closeApplication();
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [startupError, rollbackError],
        "Daemon server startup failed and its rollback was incomplete."
      );
    }
    throw startupError;
  }
}
