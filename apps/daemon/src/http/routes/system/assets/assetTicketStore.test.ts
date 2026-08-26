import assert from "node:assert/strict";
import test from "node:test";

import { AssetTicketStore } from "./assetTicketStore.ts";

test("asset tickets are isolated per HTTP application lifecycle", () => {
  let now = 100;
  const first = new AssetTicketStore(2, 10, () => now);
  const second = new AssetTicketStore(2, 10, () => now);
  const created = first.create({
    download: false,
    fileIdentity: { deviceId: 1n, inodeId: 2n },
    kind: "file",
    path: "C:\\tmp\\artifact.txt",
    requestedPath: "C:\\tmp\\artifact-link.txt"
  });

  assert.equal(first.read(created.id)?.path, "C:\\tmp\\artifact.txt");
  assert.equal(second.read(created.id), null);

  now = 111;
  assert.equal(first.read(created.id), null);
});
