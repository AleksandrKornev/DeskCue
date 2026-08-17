import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_RELAY_V1_CONTRACT_FIXTURES,
  CLOUD_RELAY_V1_CONTRACT_MANIFEST,
  parseCloudRemoteReadOperationInput,
  parseCloudPreviewServerFrame,
  parseRemoteControlOperationInput,
  parseRemoteRealtimePath
} from "../dist/index.js";

test("exports the canonical JSON-serializable Cloud relay v1 manifest", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(CLOUD_RELAY_V1_CONTRACT_MANIFEST)),
    CLOUD_RELAY_V1_CONTRACT_MANIFEST
  );
  assert.equal(CLOUD_RELAY_V1_CONTRACT_MANIFEST.preview.protocolVersion, 1);
  assert.ok(CLOUD_RELAY_V1_CONTRACT_MANIFEST.preview.frameTypes.includes("preview.flow.credit"));
  assert.equal(CLOUD_RELAY_V1_CONTRACT_MANIFEST.limits.previewWebSocketStreams, 24);
  assert.deepEqual(CLOUD_RELAY_V1_CONTRACT_MANIFEST.capabilities, [
    "session.summary",
    "deskcue.read",
    "deskcue.files",
    "deskcue.control",
    "deskcue.realtime",
    "deskcue.preview"
  ]);
  assert.deepEqual(CLOUD_RELAY_V1_CONTRACT_MANIFEST.remoteControlOperations, [
    "source.attach",
    "managed.input",
    "managed.interrupt",
    "managed.stop",
    "preview.configure",
    "preview.stop"
  ]);
  assert.deepEqual(
    CLOUD_RELAY_V1_CONTRACT_MANIFEST.realtime.allowedQueryParameters,
    ["clientId", "afterCursor", "protocolCapability", "protocolVersion"]
  );
});

test("canonical Cloud relay v1 fixtures pass the public runtime parsers", () => {
  const { remoteReadInputs, remoteControlInputs, remoteRealtime, remotePreview } =
    CLOUD_RELAY_V1_CONTRACT_FIXTURES;
  assert.deepEqual(
    Object.keys(remoteReadInputs),
    CLOUD_RELAY_V1_CONTRACT_MANIFEST.remoteReadOperations
  );
  for (const [operation, input] of Object.entries(remoteReadInputs)) {
    assert.deepEqual(parseCloudRemoteReadOperationInput(operation, input), input);
  }
  assert.deepEqual(
    Object.keys(remoteControlInputs),
    CLOUD_RELAY_V1_CONTRACT_MANIFEST.remoteControlOperations
  );
  for (const [operation, fixture] of Object.entries(remoteControlInputs)) {
    assert.deepEqual(parseRemoteControlOperationInput(operation, fixture.input), fixture.input);
  }
  assert.equal(parseRemoteRealtimePath(remoteRealtime.path), remoteRealtime.path);
  assert.deepEqual(
    parseCloudPreviewServerFrame(remotePreview.httpRequestStart),
    remotePreview.httpRequestStart
  );
  assert.deepEqual(
    parseCloudPreviewServerFrame(remotePreview.responseCredit),
    remotePreview.responseCredit
  );
});
