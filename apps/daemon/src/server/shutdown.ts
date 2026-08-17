import type { Server } from "node:http";

import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

type ShutdownSignal = "SIGINT" | "SIGTERM";
type ShutdownReason =
  | ShutdownSignal
  | "httpServerError"
  | "uncaughtException"
  | "unhandledRejection";

type CloseDaemonResourcesOptions = {
  closeApplication?: () => Promise<void> | void;
  closeIngress?: () => Promise<void> | void;
  closeRealtime: (callback: () => void) => void;
  server: Server;
};

type ShutdownTimeout = {
  cancel?: () => void;
  unref: () => void;
};

type ShutdownHandlerOptions = CloseDaemonResourcesOptions & {
  exitProcess?: (exitCode: number) => void;
  flushLogs?: () => Promise<void> | void;
  setShutdownTimeout?: (callback: () => void, timeoutMs: number) => ShutdownTimeout;
};

export type ShutdownHandler = (
  reason: ShutdownReason,
  initialExitCode?: number
) => Promise<void>;

function createProcessHandlerDisposer(dispose: () => void) {
  let disposed = false;

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    dispose();
  };
}

export function registerShutdownHandlers(shutdown: ShutdownHandler) {
  const onSigint = () => {
    void shutdown("SIGINT");
  };
  const onSigterm = () => {
    void shutdown("SIGTERM");
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return createProcessHandlerDisposer(() => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  });
}

function closeHttpServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeIdleConnections();
  });
}

function closeRealtimeServer(closeRealtime: (callback: () => void) => void) {
  return new Promise<void>((resolve, reject) => {
    try {
      closeRealtime(resolve);
    } catch (error) {
      reject(error);
    }
  });
}

export async function closeDaemonResources({
  closeApplication = () => {},
  closeIngress = () => {},
  closeRealtime,
  server
}: CloseDaemonResourcesOptions) {
  const failures: unknown[] = [];
  try {
    await closeIngress();
  } catch (error) {
    failures.push(error);
  }

  const transportResults = await Promise.allSettled([
    closeHttpServer(server),
    closeRealtimeServer(closeRealtime)
  ]);
  for (const result of transportResults) {
    if (result.status === "rejected") {
      const reason: unknown = result.reason;
      failures.push(reason);
    }
  }

  try {
    await closeApplication();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, "DeskCue daemon resource drain failed.");
  }
}

function createShutdownTimeout(callback: () => void, timeoutMs: number): ShutdownTimeout {
  const timeout = setTimeout(callback, timeoutMs);
  return {
    cancel: () => clearTimeout(timeout),
    unref: () => timeout.unref()
  };
}

export function createShutdownHandler({
  closeApplication = () => {},
  closeIngress = () => {},
  closeRealtime,
  exitProcess = (exitCode) => process.exit(exitCode),
  flushLogs = () => {},
  server,
  setShutdownTimeout = createShutdownTimeout
}: ShutdownHandlerOptions): ShutdownHandler {
  let requestedExitCode = 0;
  let shutdownFinished = false;
  let shutdownPromise: Promise<void> | null = null;
  let shutdownTimeout: ShutdownTimeout | null = null;

  return (reason, initialExitCode = 0) => {
    requestedExitCode = Math.max(requestedExitCode, initialExitCode);
    if (shutdownPromise) {
      return shutdownPromise;
    }

    logger.info("DeskCue daemon shutdown started", {
      parentPid: process.ppid,
      pid: process.pid,
      reason,
      uptimeMs: Math.round(process.uptime() * 1_000)
    });

    shutdownPromise = closeDaemonResources({
      closeApplication,
      closeIngress,
      closeRealtime,
      server
    })
      .catch((error: unknown) => {
        requestedExitCode = 1;
        logger.error("DeskCue daemon shutdown failed", {
          message: error instanceof Error ? error.message : String(error),
          pid: process.pid,
          reason
        });
      })
      .then(async () => {
        if (shutdownFinished) {
          return;
        }

        logger.info("DeskCue daemon shutdown complete", {
          exitCode: requestedExitCode,
          parentPid: process.ppid,
          pid: process.pid,
          reason,
          uptimeMs: Math.round(process.uptime() * 1_000)
        });
        try {
          await flushLogs();
        } catch (error) {
          requestedExitCode = 1;
          process.stderr.write(
            `DeskCue daemon failed to flush logs during shutdown: ${
              error instanceof Error ? error.message : String(error)
            }\n`
          );
        }
        if (shutdownFinished) {
          return;
        }
        shutdownFinished = true;
        shutdownTimeout?.cancel?.();
        exitProcess(requestedExitCode);
      });

    shutdownTimeout = setShutdownTimeout(() => {
      if (shutdownFinished) {
        return;
      }
      shutdownFinished = true;
      logger.warn("DeskCue daemon shutdown timed out", {
        pid: process.pid,
        reason
      });
      exitProcess(1);
    }, daemonConfig.shutdownTimeoutMs);
    shutdownTimeout.unref();

    return shutdownPromise;
  };
}

export function createProcessErrorHandlers(shutdown: ShutdownHandler) {
  return {
    onUncaughtException(error: Error) {
      logger.error("Uncaught exception", {
        message: error.message,
        stack: error.stack
      });
      void shutdown("uncaughtException", 1);
    },
    onUnhandledRejection(reason: unknown) {
      logger.error("Unhandled promise rejection", {
        reason: reason instanceof Error ? reason.message : String(reason)
      });
      void shutdown("unhandledRejection", 1);
    }
  };
}

export function registerProcessErrorHandlers(shutdown: ShutdownHandler) {
  const { onUncaughtException, onUnhandledRejection } = createProcessErrorHandlers(shutdown);

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);

  return createProcessHandlerDisposer(() => {
    process.off("uncaughtException", onUncaughtException);
    process.off("unhandledRejection", onUnhandledRejection);
  });
}

export function registerHttpServerErrorHandler(server: Server, shutdown: ShutdownHandler) {
  const onError = (error: Error & { code?: string }) => {
    logger.error("DeskCue HTTP server failed", {
      code: error.code,
      message: error.message,
      pid: process.pid
    });
    void shutdown("httpServerError", 1);
  };

  server.on("error", onError);
  return createProcessHandlerDisposer(() => {
    server.off("error", onError);
  });
}
