import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { DaemonEventBus } from "#application/ports";
import { SqliteNotificationStateStore } from "#persistence/journals/notificationStateStore";

import { createPushNotificationService } from "./pushNotificationService.ts";

class RejectingNotificationStateStore extends SqliteNotificationStateStore {
  closed = false;

  override saveStateJson() {
    throw new Error("state save failed");
  }

  override close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    super.close();
  }
}

test("notification startup rejection removes its event listener and closes its store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-push-startup-"));
  const events = new EventEmitter();
  const stateStore = new RejectingNotificationStateStore(
    join(directory, "notifications.sqlite")
  );

  try {
    await assert.rejects(
      createPushNotificationService({
        events: events as unknown as DaemonEventBus,
        stateStore,
        storagePath: join(directory, "legacy-state.json")
      }),
      /state save failed/
    );

    assert.equal(events.listenerCount("event"), 0);
    assert.equal(stateStore.closed, true);
  } finally {
    stateStore.close();
    await rm(directory, { force: true, recursive: true });
  }
});
