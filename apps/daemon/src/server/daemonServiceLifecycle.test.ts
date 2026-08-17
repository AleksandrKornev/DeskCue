import assert from "node:assert/strict";
import test from "node:test";

import { createDaemonServiceLifecycle } from "./daemonServiceLifecycle.ts";

test("failed notification startup rolls back created resources in ownership order", async () => {
  const calls: string[] = [];

  await assert.rejects(
    createDaemonServiceLifecycle({
      closeAccessStore: () => calls.push("access.close"),
      closeSqliteContext: () => calls.push("sqlite.close"),
      createApplication: async () => ({
        close: async () => {
          calls.push("application.close");
        }
      }),
      createNotifications: async () => {
        throw new Error("notification startup failed");
      }
    }),
    /notification startup failed/
  );

  assert.deepEqual(calls, [
    "application.close",
    "access.close",
    "sqlite.close"
  ]);
});

test("failed application startup still releases access and SQLite ownership", async () => {
  const calls: string[] = [];

  await assert.rejects(
    createDaemonServiceLifecycle({
      closeAccessStore: () => calls.push("access.close"),
      closeSqliteContext: () => calls.push("sqlite.close"),
      createApplication: async () => {
        throw new Error("application startup failed");
      },
      createNotifications: async () => ({ close: () => {} })
    }),
    /application startup failed/
  );

  assert.deepEqual(calls, ["access.close", "sqlite.close"]);
});

test("normal service close is idempotent and keeps producer-first order", async () => {
  const calls: string[] = [];
  const lifecycle = await createDaemonServiceLifecycle({
    closeAccessStore: () => calls.push("access.close"),
    closeSqliteContext: () => calls.push("sqlite.close"),
    createApplication: async () => ({
      close: async () => {
        calls.push("application.close");
      }
    }),
    createNotifications: async () => ({
      close: async () => {
        calls.push("notifications.close");
      }
    })
  });

  await Promise.all([lifecycle.close(), lifecycle.close()]);
  await lifecycle.close();

  assert.deepEqual(calls, [
    "application.close",
    "notifications.close",
    "access.close",
    "sqlite.close"
  ]);
});
