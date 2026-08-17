import assert from "node:assert/strict";
import test from "node:test";

import { daemonConfig } from "#config/daemonConfig";
import { getProductionSqliteDatabaseContext } from "#persistence/connection/sqliteConnection";

import { accessDeviceStore, bindProductionAccessDeviceStore } from "./accessDevices.ts";

test("production access store rebinds after an in-process daemon restart", () => {
  const firstContext = getProductionSqliteDatabaseContext(
    daemonConfig.databaseFilePath
  );
  const firstStore = bindProductionAccessDeviceStore(firstContext);
  const created = firstStore.createDevice({
    ip: "127.0.0.1",
    label: "Restart regression",
    userAgent: "DeskCue test"
  });

  firstContext.close();

  const secondContext = getProductionSqliteDatabaseContext(
    daemonConfig.databaseFilePath
  );
  try {
    const secondStore = bindProductionAccessDeviceStore(secondContext);

    assert.notStrictEqual(secondStore, firstStore);
    assert.strictEqual(accessDeviceStore, secondStore);
    assert.deepEqual(secondStore.authenticateToken(created.accessToken), {
      id: created.device.id,
      label: "Restart regression"
    });
  } finally {
    secondContext.close();
  }
});
