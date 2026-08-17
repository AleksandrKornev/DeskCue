import type express from "express";
import type { Server } from "node:http";

import { daemonConfig } from "#config/daemonConfig";
import { logger } from "#infrastructure/logging/logger";

export const HTTP_SERVER_LIMITS = {
  headersTimeoutMs: 15_000,
  keepAliveTimeoutMs: 5_000,
  maxRequestsPerSocket: 100,
  requestTimeoutMs: 120_000
} as const;

export function configureHttpServer(server: Server) {
  server.headersTimeout = HTTP_SERVER_LIMITS.headersTimeoutMs;
  server.keepAliveTimeout = HTTP_SERVER_LIMITS.keepAliveTimeoutMs;
  server.maxRequestsPerSocket = HTTP_SERVER_LIMITS.maxRequestsPerSocket;
  server.requestTimeout = HTTP_SERVER_LIMITS.requestTimeoutMs;
}

function isLoopbackBindHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function listenOnce(appInstance: express.Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const candidateServer = appInstance.listen(port, host);
    configureHttpServer(candidateServer);
    let onError: (error: Error) => void;

    const onListening = () => {
      candidateServer.off("error", onError);
      logger.info("DeskCue daemon listening", {
        dashboardUrl: `http://localhost:${port}`,
        url: `http://${host}:${port}`,
        pid: process.pid,
        authRequired: daemonConfig.authRequired,
        logLevel: process.env.DESKCUE_LOG_LEVEL ?? "info"
      });

      if (!daemonConfig.authRequired && !isLoopbackBindHost(host)) {
        logger.warn("DeskCue daemon authentication is disabled on a non-loopback host", {
          host,
          port
        });
      }

      resolve(candidateServer);
    };

    onError = (error: Error) => {
      candidateServer.off("listening", onListening);
      reject(error);
    };

    candidateServer.once("listening", onListening);
    candidateServer.once("error", onError);
  });
}

function isAddressInUseError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

async function isHealthyDeskCueDaemon(port: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), daemonConfig.healthCheckTimeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export async function listenWithRetry(
  appInstance: express.Express,
  port: number,
  host = daemonConfig.bindHost
): Promise<Server | null> {
  for (let attempt = 1; attempt <= daemonConfig.listenRetryAttempts; attempt += 1) {
    try {
      return await listenOnce(appInstance, port, host);
    } catch (error) {
      if (!isAddressInUseError(error) || attempt === daemonConfig.listenRetryAttempts) {
        const message = error instanceof Error ? error.message : "Failed to bind HTTP server.";
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        logger.error("DeskCue daemon failed to bind HTTP server", {
          pid: process.pid,
          host,
          port,
          code,
          message
        });
        throw error;
      }

      if (await isHealthyDeskCueDaemon(port)) {
        logger.info("DeskCue daemon is already running on this port; exiting duplicate process", {
          pid: process.pid,
          port,
          attempt
        });
        return null;
      }

      logger.debug("DeskCue daemon port is still busy, retrying bind", {
        pid: process.pid,
        port,
        attempt,
        retryDelayMs: daemonConfig.listenRetryDelayMs
      });
      await delay(daemonConfig.listenRetryDelayMs);
    }
  }

  throw new Error("Unreachable daemon listen retry state.");
}
