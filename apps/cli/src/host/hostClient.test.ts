import assert from "node:assert/strict";
import net from "node:net";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HostControlTokenReadError,
  resolveHostControlEndpoint,
  resolveHostControlPaths
} from "@deskcue/host-control";
import type { HostStatus } from "@deskcue/host-control";

import { ensureHostRunning, launchDetachedHost } from "./hostLauncher.ts";
import { createHostRequest, readOptionalHostStatus } from "./hostClient.ts";

const stoppedStatus: HostStatus = {
  autostart: { enabled: false, supported: true },
  busyReason: null,
  capabilities: {},
  daemon: {
    baseUrl: null,
    generation: null,
    lastError: null,
    pid: null,
    port: null,
    restartAttempt: 0,
    state: "stopped",
    version: null
  },
  host: {
    pid: 42,
    startedAt: "2026-09-13T00:00:00.000Z",
    state: "running",
    version: "0.1.1"
  },
  update: {
    availableVersion: null,
    lastError: null,
    state: "idle"
  }
};

test("optional status treats a missing host token as absent", async () => {
  const status = await readOptionalHostStatus(async () => {
    const error = new Error("missing") as NodeJS.ErrnoException;

    error.code = "ENOENT";

    throw error;
  });

  assert.equal(status, null);
});

test("optional status fails closed when the token is missing but the endpoint is live", async () => {
  const root = mkdtempSync(join(tmpdir(), "deskcue-cli-live-host-missing-token-"));
  const paths = resolveHostControlPaths(root);
  const endpoint = resolveHostControlEndpoint("", paths);

  mkdirSync(paths.serviceDataPath, { recursive: true });
  const server = net.createServer((socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });

  try {
    await assert.rejects(
      readOptionalHostStatus(createHostRequest(paths), 1_000),
      (error) => error instanceof HostControlTokenReadError
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { force: true, recursive: true });
  }
});

test("ensure host is idempotent when it is already running", async () => {
  let launches = 0;
  const status = await ensureHostRunning(
    async () => stoppedStatus,
    async () => {
      launches += 1;
    }
  );

  assert.equal(status, stoppedStatus);
  assert.equal(launches, 0);
});

test("ensure host launches once and waits for control readiness", async () => {
  let attempts = 0;
  let launches = 0;
  const status = await ensureHostRunning(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("not ready") as NodeJS.ErrnoException;

        error.code = "ENOENT";

        throw error;
      }

      return stoppedStatus;
    },
    async () => {
      launches += 1;
    }
  );

  assert.equal(status, stoppedStatus);
  assert.equal(launches, 1);
  assert.equal(attempts, 3);
});

test("ensure host applies an absolute deadline to a stuck readiness request", async () => {
  let attempts = 0;
  const startedAt = Date.now();

  await assert.rejects(
    ensureHostRunning(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("not ready") as NodeJS.ErrnoException;

          error.code = "ENOENT";
          throw error;
        }

        return new Promise(() => {});
      },
      async () => {},
      100
    ),
    /startup timed out/u
  );

  assert.ok(Date.now() - startedAt < 300);
});

test("installed Linux launcher delegates Host ownership to the systemd user service", async () => {
  let starts = 0;

  await launchDetachedHost({
    env: { DESKCUE_HOST_LAUNCH_MODE: "systemd-user" },
    platform: "linux",
    startSystemdService: async () => {
      starts += 1;
    }
  });

  assert.equal(starts, 1);
});
