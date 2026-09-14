import assert from "node:assert/strict";
import test from "node:test";

import type { HostControlServer } from "./controlServer.ts";
import { HostApplication } from "./hostApplication.ts";
import type { HostRuntime } from "./hostRuntime.ts";

test("Host application observes protocol shutdown while initial daemon startup is unresolved", async () => {
  let allowShutdown = true;
  let closeCalls = 0;
  const exitCodes: number[] = [];
  let finishStartup: (() => void) | undefined;
  const startup = new Promise<void>((resolve) => {
    finishStartup = resolve;
  });
  const runtime = {
    close: async () => {
      closeCalls += 1;
    },
    startInitialDaemon: () => startup,
    get status() {
      return {
        capabilities: {
          "host.shutdown": { allowed: allowShutdown, reason: null }
        }
      };
    }
  };

  const controlServer = { close: async () => undefined };
  const application = new HostApplication(
    runtime as unknown as HostRuntime,
    controlServer as unknown as HostControlServer,
    {
      exit: (exitCode) => {
        exitCodes.push(exitCode);
      },
      shutdownPollIntervalMs: 1
    }
  );
  const starting = application.start();

  allowShutdown = false;
  while (closeCalls === 0) await new Promise((resolve) => setTimeout(resolve, 2));

  assert.equal(closeCalls, 1);
  finishStartup?.();
  await starting;
  await application.close();
  assert.deepEqual(exitCodes, [0]);
});

test("Host application retries final cleanup after a late forced daemon exit", async () => {
  let daemonPresent = true;
  let closeCalls = 0;
  let serverCloseCalls = 0;
  const exitCodes: number[] = [];
  const failures: unknown[] = [];
  const runtime = {
    close: async () => {
      closeCalls += 1;
      if (daemonPresent) {
        throw Object.assign(new Error("daemon exit was not confirmed"), { code: "daemon_stop_timeout" });
      }
    },
    startInitialDaemon: async () => undefined,
    status: {
      capabilities: {
        "host.shutdown": { allowed: false, reason: "DeskCue Host is already shutting down." }
      }
    }
  };

  const controlServer = {
    close: async () => {
      serverCloseCalls += 1;
    }
  };

  const application = new HostApplication(
    runtime as unknown as HostRuntime,
    controlServer as unknown as HostControlServer,
    {
      exit: (exitCode) => {
        exitCodes.push(exitCode);
      },
      reportCloseFailure: (error) => {
        failures.push(error);
      },
      shutdownPollIntervalMs: 10
    }
  );

  await application.start();
  while (failures.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));

  assert.equal(failures.length, 1);
  assert.equal(serverCloseCalls, 0);
  assert.deepEqual(exitCodes, []);

  daemonPresent = false;
  while (exitCodes.length === 0) await new Promise((resolve) => setTimeout(resolve, 2));

  assert.equal(closeCalls, 2);
  assert.equal(serverCloseCalls, 1);
  assert.deepEqual(exitCodes, [0]);
});

test("Host application retries a failed signal shutdown until the daemon exits", async () => {
  let daemonPresent = true;
  let closeCalls = 0;
  let serverCloseCalls = 0;
  const exitCodes: number[] = [];
  const failures: unknown[] = [];
  const runtime = {
    close: async () => {
      closeCalls += 1;
      if (daemonPresent) {
        throw Object.assign(new Error("daemon exit was not confirmed"), { code: "daemon_stop_timeout" });
      }
    },
    startInitialDaemon: async () => undefined,
    status: {
      capabilities: {
        "host.shutdown": { allowed: false, reason: "DeskCue Host is already shutting down." }
      }
    }
  };

  const controlServer = {
    close: async () => {
      serverCloseCalls += 1;
    }
  };

  const application = new HostApplication(
    runtime as unknown as HostRuntime,
    controlServer as unknown as HostControlServer,
    {
      exit: (exitCode) => {
        exitCodes.push(exitCode);
      },
      reportCloseFailure: (error) => {
        failures.push(error);
      },
      shutdownPollIntervalMs: 10
    }
  );

  await application.start();
  process.emit("SIGTERM", "SIGTERM");
  while (failures.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));

  assert.deepEqual(exitCodes, []);
  assert.equal(serverCloseCalls, 0);

  daemonPresent = false;
  while (exitCodes.length === 0) await new Promise((resolve) => setTimeout(resolve, 2));

  assert.equal(closeCalls, 2);
  assert.equal(serverCloseCalls, 1);
  assert.deepEqual(exitCodes, [0]);
});

test("Host application releases the singleton endpoint when initial startup rejects", async () => {
  let runtimeCloseCalls = 0;
  let serverCloseCalls = 0;
  const startupError = new Error("runtime metadata is not writable");
  const runtime = {
    close: async () => {
      runtimeCloseCalls += 1;
    },
    startInitialDaemon: async () => {
      throw startupError;
    },
    status: {
      capabilities: {
        "host.shutdown": { allowed: true, reason: null }
      }
    }
  };

  const controlServer = {
    close: async () => {
      serverCloseCalls += 1;
    }
  };

  const application = new HostApplication(
    runtime as unknown as HostRuntime,
    controlServer as unknown as HostControlServer
  );

  await assert.rejects(
    application.start().catch((error) => application.abortStart(error)),
    (error) => error === startupError
  );

  assert.equal(runtimeCloseCalls, 1);
  assert.equal(serverCloseCalls, 1);
});
