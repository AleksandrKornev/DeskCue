import { loadDaemonEnvFiles } from "#config/envFiles";

import { createManagedShutdown } from "./managedShutdown.ts";

type HostChildMessage = {
  reason?: "host-request" | "host-shutdown";
  requestId?: string;
  type: "shutdown" | "prepare-update" | "cancel-update";
};

if (process.env.DESKCUE_DISTRIBUTION_MODE !== "installed") loadDaemonEnvFiles();

const { DESKCUE_VERSION } = await import("#config/deskCueVersion");
const { flushLogger, logger } = await import("#infrastructure/logging/logger");
const { startDaemonServer } = await import("#server/startDaemonServer");

let controller: Awaited<ReturnType<typeof startDaemonServer>> = null;
let startupPromise: ReturnType<typeof startDaemonServer> | null = null;
let shutdownRequested = false;
let updateDrainLease: { backupPath?: string | null; release: () => Promise<void> | void } | null = null;
let updateDrainQueue = Promise.resolve();

function sendToHost(message: unknown) {
  if (process.connected) process.send?.(message);
}

async function awaitControllerForShutdown() {
  if (controller) return controller;
  if (!startupPromise) return null;

  return startupPromise;
}

const runManagedShutdown = createManagedShutdown({
  awaitController: awaitControllerForShutdown,
  disconnect: () => process.disconnect?.(),
  flush: () => flushLogger(),
  reportFailure: (error, reason) => {
    logger.error("Managed daemon shutdown failed", {
      message: error instanceof Error ? error.message : String(error),
      reason
    });
  },
  sendStopped: () => sendToHost({ type: "stopped" }),
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  }
});

function shutdown(reason: "host-request" | "host-shutdown") {
  shutdownRequested = true;

  return runManagedShutdown(reason);
}

function sendUpdateReadinessFailure(requestId: string, error: unknown) {
  sendToHost({
    blockers: [{
      code: "update_readiness_failed",
      count: 1,
      message: error instanceof Error ? error.message : String(error)
    }],
    ok: false,
    requestId,
    type: "update-readiness"
  });
}

async function prepareUpdate(requestId: string) {
  if (!controller) throw new Error("DeskCue daemon is not ready for update preparation.");

  if (updateDrainLease) {
    sendToHost({
      ...(updateDrainLease.backupPath !== undefined ? { backupPath: updateDrainLease.backupPath } : {}),
      blockers: [],
      ok: true,
      requestId,
      type: "update-readiness"
    });
    return;
  }

  const result = await controller.beginUpdateDrain();

  if (result.ok) updateDrainLease = result;
  sendToHost({
    ...(result.ok ? { backupPath: result.backupPath } : {}),
    blockers: result.blockers,
    ok: result.ok,
    requestId,
    type: "update-readiness"
  });
}

async function cancelUpdate(requestId: string) {
  const lease = updateDrainLease;

  updateDrainLease = null;
  await Promise.resolve(lease?.release());
  sendToHost({
    blockers: [],
    ok: true,
    requestId,
    type: "update-readiness"
  });
}

function queueUpdateOperation(requestId: string, operation: () => Promise<void>) {
  updateDrainQueue = updateDrainQueue
    .then(operation, operation)
    .catch((error) => sendUpdateReadinessFailure(requestId, error));
}

process.on("message", (message: HostChildMessage) => {
  if (message?.type === "shutdown") {
    void shutdown(message.reason ?? "host-request");
  } else if (message?.type === "prepare-update" && message.requestId) {
    queueUpdateOperation(message.requestId, () => prepareUpdate(message.requestId!));
  } else if (message?.type === "cancel-update" && message.requestId) {
    queueUpdateOperation(message.requestId, () => cancelUpdate(message.requestId!));
  }
});
process.once("disconnect", () => {
  void shutdown("host-shutdown");
});

try {
  startupPromise = startDaemonServer();
  controller = await startupPromise;
  if (!controller) {
    throw Object.assign(new Error("Another DeskCue daemon already owns the configured port."), {
      retryable: false
    });
  }

  if (shutdownRequested) {
    await shutdown("host-shutdown");
  } else {
    sendToHost({
      baseUrl: controller.baseUrl,
      pid: process.pid,
      port: controller.port,
      type: "ready",
      version: DESKCUE_VERSION
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  sendToHost({ message, retryable: false, type: "startup-failed" });

  logger.error("Managed DeskCue daemon startup failed", { message });
  process.exitCode = 1;
  await flushLogger().catch(() => undefined);
  process.disconnect?.();
}
