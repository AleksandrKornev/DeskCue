import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_RELAY_CAPABILITY,
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_RELAY_STREAM,
  CLOUD_REMOTE_CONTROL_CAPABILITY,
  CLOUD_REMOTE_FILES_CAPABILITY,
  CLOUD_REMOTE_PREVIEW_CAPABILITY,
  CLOUD_REMOTE_READ_CAPABILITY,
  CLOUD_REMOTE_REALTIME_CAPABILITY
} from "@deskcue/protocol";
import type { CloudRelayWelcome } from "@deskcue/protocol";
import type { CloudConnectorProfile } from "#persistence/cloud/cloudConnectorStore";

import { CloudRelayNegotiation } from "./connector/cloudRelayNegotiation.ts";

const profile: CloudConnectorProfile = {
  id: "profile-1",
  cloudOrigin: "https://cloud.example.test",
  displayName: "Test machine",
  enabled: true,
  state: "connecting",
  machineId: "machine-1",
  protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
  lastConnectedAt: null,
  lastErrorCode: null,
  credentialRef: "test-credential",
  remoteReadEnabled: true,
  remoteFilesEnabled: true,
  remoteControlEnabled: false,
  remotePreviewEnabled: true,
  sessionLabelDisclosureEnabled: false
};

function createWelcome(
  negotiatedCapabilities: CloudRelayWelcome["negotiatedCapabilities"]
): CloudRelayWelcome {
  return {
    type: "relay.welcome",
    protocolVersion: CLOUD_RELAY_PROTOCOL_VERSION,
    connectionId: "connection-1",
    machineId: "machine-1",
    negotiatedCapabilities,
    streamPositions: [{ stream: CLOUD_RELAY_STREAM, nextSequence: 7 }],
    heartbeatIntervalMs: 30_000,
    maxFrameBytes: 16_384,
    connectedAt: "2026-08-11T00:00:00.000Z"
  };
}

test("relay negotiation validates welcome and records only negotiated capabilities", () => {
  const negotiation = new CloudRelayNegotiation();
  const result = negotiation.acceptWelcome(profile, createWelcome([
    CLOUD_RELAY_CAPABILITY,
    CLOUD_REMOTE_READ_CAPABILITY,
    CLOUD_REMOTE_REALTIME_CAPABILITY,
    CLOUD_REMOTE_PREVIEW_CAPABILITY
  ]));

  assert.deepEqual(result, {
    connectedAt: "2026-08-11T00:00:00.000Z",
    nextServerSequence: 7
  });
  assert.equal(negotiation.remoteRead, true);
  assert.equal(negotiation.remoteRealtime, true);
  assert.equal(negotiation.remotePreview, true);
  assert.equal(negotiation.remoteFiles, false);
  assert.equal(negotiation.remoteControl, false);
});

test("relay negotiation rejects duplicate and locally ungranted welcome capabilities", () => {
  const negotiation = new CloudRelayNegotiation();
  const welcome = createWelcome([CLOUD_RELAY_CAPABILITY, CLOUD_REMOTE_FILES_CAPABILITY]);
  negotiation.acceptWelcome(profile, welcome);
  assert.throws(() => negotiation.acceptWelcome(profile, welcome), /more than one welcome/);

  negotiation.reset();
  assert.throws(
    () => negotiation.acceptWelcome(profile, createWelcome([
      CLOUD_RELAY_CAPABILITY,
      CLOUD_REMOTE_CONTROL_CAPABILITY
    ])),
    /identity or capability mismatch/
  );
});
